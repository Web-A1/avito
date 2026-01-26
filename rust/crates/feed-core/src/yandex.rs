use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mime_guess::MimeGuess;
use reqwest::blocking::{Client, Response};
use reqwest::Method;
use reqwest::StatusCode;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct YandexClient {
    token: String,
    client: Client,
    retry_attempts: u32,
    retry_delay: Duration,
    base_url: String,
    use_curl: bool,
}

#[derive(Debug, Clone)]
pub struct UploadResult {
    pub disk_path: String,
    pub public_url: String,
    pub size: u64,
}

#[derive(Debug, Clone)]
pub struct UploadOnlyResult {
    pub disk_path: String,
    pub size: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum YandexError {
    #[error("HTTP {status}: {body}")]
    Http { status: StatusCode, body: String },
    #[error("Запрос не удался: {0}")]
    Request(String),
    #[error("Не удалось прочитать файл {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Не удалось распарсить ответ API: {0}")]
    Parse(String),
    #[error("Не удалось получить public_url")]
    MissingPublicUrl,
}

impl YandexClient {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .http1_only()
                .build()
                .expect("failed to build reqwest client"),
            retry_attempts: 4,
            retry_delay: Duration::from_millis(300),
            base_url: "https://cloud-api.yandex.net".to_string(),
            use_curl: true,
        }
    }

    pub fn with_retries(mut self, attempts: u32, delay: Duration) -> Self {
        self.retry_attempts = attempts.max(1);
        self.retry_delay = delay;
        self
    }

    pub fn with_curl(mut self, enabled: bool) -> Self {
        self.use_curl = enabled;
        self
    }

    fn auth_header(&self) -> String {
        format!("OAuth {}", self.token)
    }

    /// Проверяет, существует ли файл на диске.
    pub fn resource_exists(&self, disk_path: &str) -> Result<bool, YandexError> {
        let info_url = format!(
            "{}/v1/disk/resources?path={}",
            self.base_url,
            urlencoding::encode(disk_path)
        );
        let res = self
            .client
            .get(&info_url)
            .header("Authorization", self.auth_header())
            .send()
            .map_err(|e| YandexError::Request(e.to_string()))?;
        if res.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        if !res.status().is_success() {
            return Err(to_http_error(res)?);
        }
        Ok(true)
    }

    /// PUT /resources to ensure folder exists (409 считается успехом).
    pub fn ensure_folder(&self, disk_path: &str) -> Result<(), YandexError> {
        let url = format!(
            "{}/v1/disk/resources?path={}",
            self.base_url,
            urlencoding::encode(disk_path)
        );
        let res = self
            .client
            .put(url)
            .header("Authorization", self.auth_header())
            .send()
            .map_err(|e| YandexError::Request(e.to_string()))?;
        if res.status() == StatusCode::CONFLICT {
            return Ok(());
        }
        if !res.status().is_success() {
            return Err(to_http_error(res)?);
        }
        Ok(())
    }

    /// Полный цикл загрузки и публикации файла.
    pub fn upload_and_publish(
        &self,
        local_path: impl AsRef<Path>,
        disk_path: &str,
    ) -> Result<UploadResult, YandexError> {
        let upload = self.upload_only(local_path, disk_path)?;
        let public_url = self.publish_and_get_public_url(disk_path)?;
        Ok(UploadResult {
            disk_path: upload.disk_path,
            public_url,
            size: upload.size,
        })
    }

    /// Только загрузка (без публикации).
    pub fn upload_only(
        &self,
        local_path: impl AsRef<Path>,
        disk_path: &str,
    ) -> Result<UploadOnlyResult, YandexError> {
        let path_ref = local_path.as_ref();
        let data = fs::read(path_ref).map_err(|e| YandexError::Io {
            path: path_ref.display().to_string(),
            source: e,
        })?;
        self.ensure_folder_parent(disk_path)?;
        let target = self.get_upload_url(disk_path)?;
        // Попытка через curl (если включено).
        if self.use_curl {
            if let Err(e) = upload_via_curl(path_ref, &target.href) {
                eprintln!("⚠️  curl upload failed, fallback to HTTP: {}", e);
                let mime = mime_from_path(path_ref);
                self.put_bytes_with_retry(&target.href, data.clone(), &mime, target.method)?;
            }
        } else {
            let mime = mime_from_path(path_ref);
            self.put_bytes_with_retry(&target.href, data.clone(), &mime, target.method)?;
        }
        Ok(UploadOnlyResult {
            disk_path: disk_path.to_string(),
            size: data.len() as u64,
        })
    }

    /// Публикация и получение public_url (с ретраями).
    pub fn publish_and_get_public_url(&self, disk_path: &str) -> Result<String, YandexError> {
        self.publish_with_retry(disk_path)
    }

    fn ensure_folder_parent(&self, disk_path: &str) -> Result<(), YandexError> {
        if let Some((parent, _)) = disk_path.rsplit_once('/') {
            if !parent.is_empty() {
                return self.ensure_folder(parent);
            }
        }
        Ok(())
    }

    fn get_upload_url(&self, disk_path: &str) -> Result<UploadTarget, YandexError> {
        let url = format!(
            "{}/v1/disk/resources/upload?path={}&overwrite=true",
            self.base_url,
            urlencoding::encode(disk_path)
        );
        let res = self
            .client
            .get(url)
            .header("Authorization", self.auth_header())
            .send()
            .map_err(|e| YandexError::Request(e.to_string()))?;
        if !res.status().is_success() {
            return Err(to_http_error(res)?);
        }
        let json: serde_json::Value = res.json().map_err(|e| YandexError::Parse(e.to_string()))?;
        let href = json
            .get("href")
            .and_then(|v| v.as_str())
            .ok_or_else(|| YandexError::Parse("upload href missing".into()))?;
        let method = json.get("method").and_then(|v| v.as_str()).unwrap_or("PUT");
        let method = method.parse::<Method>().unwrap_or(Method::PUT);
        Ok(UploadTarget {
            href: href.to_string(),
            method,
        })
    }

    fn put_bytes_with_retry(
        &self,
        url: &str,
        body: Vec<u8>,
        content_type: &str,
        method: Method,
    ) -> Result<(), YandexError> {
        let retryable = |status: StatusCode| {
            matches!(
                status,
                StatusCode::TOO_MANY_REQUESTS
                    | StatusCode::INTERNAL_SERVER_ERROR
                    | StatusCode::BAD_GATEWAY
                    | StatusCode::SERVICE_UNAVAILABLE
                    | StatusCode::GATEWAY_TIMEOUT
            )
        };

        if let Ok(()) = put_via_ureq(url, &body, content_type, &method) {
            return Ok(());
        }

        let mut attempt = 0;
        loop {
            attempt += 1;
            let res = self
                .client
                .request(method.clone(), url)
                .header("Content-Length", body.len().to_string())
                .header("Content-Type", content_type)
                .header("Authorization", self.auth_header())
                .body(body.clone())
                .send();
            match res {
                Ok(resp) if resp.status().is_success() => return Ok(()),
                Ok(resp) => {
                    let status = resp.status();
                    let body_text = resp.text().unwrap_or_default();
                    eprintln!("⚠️  upload failed with status {}: {}", status, body_text);
                    if status == StatusCode::METHOD_NOT_ALLOWED {
                        // Попробуем ureq как fallback (некоторые загрузчики Я.Диска ругаются на метод).
                        match put_via_ureq(url, &body, content_type, &method) {
                            Ok(_) => return Ok(()),
                            Err(e) => eprintln!("⚠️  ureq fallback failed: {}", e),
                        }
                    }
                    if status == StatusCode::LOCKED {
                        // 423: загрузка недоступна (лимит/техработы). Ретраим только при блокировке ресурса.
                        if is_traffic_limit(&body_text) {
                            eprintln!("⚠️  423 Locked: лимит загрузки/техработы (не ретраим)");
                            return Err(YandexError::Http {
                                status,
                                body: body_text,
                            });
                        }
                        if is_resource_locked(&body_text) && attempt < self.retry_attempts {
                            eprintln!("⚠️  423 Locked: ресурс занят, ретрай {}", attempt);
                            std::thread::sleep(backoff_with_jitter(self.retry_delay, attempt));
                            continue;
                        }
                        return Err(YandexError::Http {
                            status,
                            body: body_text,
                        });
                    }
                    if retryable(status) && attempt < self.retry_attempts {
                        std::thread::sleep(backoff_with_jitter(self.retry_delay, attempt));
                        continue;
                    }
                    return Err(YandexError::Http {
                        status,
                        body: body_text,
                    });
                }
                Err(err) => {
                    if attempt < self.retry_attempts {
                        std::thread::sleep(backoff_with_jitter(self.retry_delay, attempt));
                        continue;
                    }
                    return Err(YandexError::Request(err.to_string()));
                }
            }
        }
    }

    fn publish_with_retry(&self, disk_path: &str) -> Result<String, YandexError> {
        let publish_url = format!(
            "{}/v1/disk/resources/publish?path={}",
            self.base_url,
            urlencoding::encode(disk_path)
        );
        let mut last_err: Option<YandexError> = None;
        for attempt in 1..=self.retry_attempts {
            let res = self
                .client
                .put(&publish_url)
                .header("Authorization", self.auth_header())
                .send()
                .map_err(|e| YandexError::Request(e.to_string()))?;
            if res.status() == StatusCode::CONFLICT || res.status().is_success() {
                return self.fetch_public_url(disk_path);
            }
            let status = res.status();
            let body = res.text().unwrap_or_default();
            eprintln!("⚠️  publish failed {}: {}", status, body);
            last_err = Some(YandexError::Http { status, body });
            if status == StatusCode::NOT_FOUND && attempt < self.retry_attempts {
                // Ресурс мог ещё не появиться после upload — подождём и проверим наличие.
                if let Ok(true) = self.resource_exists(disk_path) {
                    // Если ресурс есть — попробуем получить public_url.
                    if let Ok(url) = self.fetch_public_url(disk_path) {
                        return Ok(url);
                    }
                }
                std::thread::sleep(self.retry_delay * attempt);
                continue;
            }
            if is_retryable_status(status) && attempt < self.retry_attempts {
                std::thread::sleep(self.retry_delay * attempt);
                continue;
            }
            break;
        }
        if let Some(err) = last_err {
            return Err(err);
        }

        Err(YandexError::MissingPublicUrl)
    }

    fn fetch_public_url(&self, disk_path: &str) -> Result<String, YandexError> {
        let info_url = format!(
            "{}/v1/disk/resources?path={}",
            self.base_url,
            urlencoding::encode(disk_path)
        );
        let mut last_err: Option<YandexError> = None;
        for attempt in 1..=self.retry_attempts {
            let res = self
                .client
                .get(&info_url)
                .header("Authorization", self.auth_header())
                .send()
                .map_err(|e| YandexError::Request(e.to_string()))?;
            if !res.status().is_success() {
                let status = res.status();
                let body = res.text().unwrap_or_default();
                eprintln!("⚠️  info failed {}: {}", status, body);
                last_err = Some(YandexError::Http { status, body });
                if status == StatusCode::NOT_FOUND && attempt < self.retry_attempts {
                    std::thread::sleep(self.retry_delay * attempt);
                    continue;
                }
            } else {
                let json: serde_json::Value =
                    res.json().map_err(|e| YandexError::Parse(e.to_string()))?;
                if let Some(public_url) = json.get("public_url").and_then(|v| v.as_str()) {
                    return Ok(public_url.to_string());
                }
                last_err = Some(YandexError::MissingPublicUrl);
            }
            if attempt < self.retry_attempts {
                std::thread::sleep(self.retry_delay * attempt);
            }
        }
        Err(last_err.unwrap_or(YandexError::MissingPublicUrl))
    }
}

fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
            | StatusCode::LOCKED
    )
}

fn to_http_error(res: Response) -> Result<YandexError, YandexError> {
    let status = res.status();
    let body = res.text().unwrap_or_default();
    Err(YandexError::Http { status, body })
}

fn is_traffic_limit(body: &str) -> bool {
    body.contains("UPLOAD_TRAFFIC_LIMIT_EXCEEDED")
        || body.contains("DiskTrafficLimitExceededError")
        || body.contains("traffic limit")
}

fn is_resource_locked(body: &str) -> bool {
    body.contains("DiskResourceLockedError")
        || body.contains("Resource is locked")
        || body.contains("Ресурс заблокирован")
}

fn backoff_with_jitter(base: Duration, attempt: u32) -> Duration {
    let base_ms = base.as_millis() as u64;
    let jitter = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_millis() as u64
        % 250;
    let mult = attempt as u64;
    Duration::from_millis(base_ms.saturating_mul(mult).saturating_add(jitter))
}

fn mime_from_path(path: &Path) -> String {
    MimeGuess::from_path(path)
        .first()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

struct UploadTarget {
    href: String,
    method: Method,
}

fn upload_via_curl(path: &Path, url: &str) -> Result<(), YandexError> {
    let output = Command::new("curl")
        .arg("-s")
        .arg("-X")
        .arg("PUT")
        .arg("-T")
        .arg(path)
        .arg("-o")
        .arg("-")
        .arg("-w")
        .arg("\n%{http_code}")
        .arg(url)
        .output()
        .map_err(|e| YandexError::Request(e.to_string()))?;
    if !output.status.success() {
        return Err(YandexError::Request(format!(
            "curl failed with status {:?}",
            output.status.code()
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let (body, code_str) = match stdout.rsplit_once('\n') {
        Some((b, c)) => (b.to_string(), c.trim().to_string()),
        None => ("".to_string(), stdout.trim().to_string()),
    };
    let code: u16 = code_str.parse().unwrap_or(0);
    let status = StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    if status.is_success() {
        Ok(())
    } else {
        Err(YandexError::Http { status, body })
    }
}

fn put_via_ureq(url: &str, body: &[u8], content_type: &str, method: &Method) -> Result<(), String> {
    let req = ureq::request(method.as_str(), url).set("Content-Type", content_type);
    let resp = req.send_bytes(body);
    match resp {
        Ok(resp_ok) => {
            if resp_ok.status() >= 200 && resp_ok.status() < 300 {
                Ok(())
            } else {
                Err(format!(
                    "ureq upload failed: {} {}",
                    resp_ok.status(),
                    resp_ok.status_text()
                ))
            }
        }
        Err(e) => Err(format!("ureq upload error: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::Method::GET;
    use httpmock::Method::PUT;
    use httpmock::MockServer;
    use std::io::Write;

    #[test]
    fn ensure_folder_allows_conflict() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/v1/disk/resources")
                .query_param("path", "folder");
            then.status(409);
        });
        let client = YandexClient::new("t").with_base(&server);
        let res = client.ensure_folder("folder");
        mock.assert();
        assert!(res.is_ok());
    }

    #[test]
    fn upload_and_publish_flow() {
        let server = MockServer::start();
        // ensure folder parent
        let ensure = server.mock(|when, then| {
            when.method(PUT)
                .path("/v1/disk/resources")
                .query_param("path", "root");
            then.status(200);
        });
        // upload href
        let upload_href = server.mock(|when, then| {
            when.method(GET)
                .path("/v1/disk/resources/upload")
                .query_param("path", "root/file.jpg")
                .query_param("overwrite", "true");
            then.status(200).json_body(serde_json::json!({
                "href": format!("{}/upload-target", server.base_url()),
                "method": "PUT"
            }));
        });
        // upload target
        let upload_target = server.mock(|when, then| {
            when.method(PUT).path("/upload-target");
            then.status(200);
        });
        // publish (PUT)
        let publish = server.mock(|when, then| {
            when.method(PUT)
                .path("/v1/disk/resources/publish")
                .query_param("path", "root/file.jpg");
            then.status(200);
        });
        // info
        let info = server.mock(|when, then| {
            when.method(GET)
                .path("/v1/disk/resources")
                .query_param("path", "root/file.jpg");
            then.status(200).json_body(serde_json::json!({
                "public_url": "https://disk.yandex.ru/i/abc",
                "size": 123
            }));
        });

        let client = YandexClient::new("t").with_base(&server);
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        writeln!(tmp, "hello").unwrap();

        let res = client
            .upload_and_publish(tmp.path(), "root/file.jpg")
            .expect("upload failed");
        ensure.assert();
        upload_href.assert();
        upload_target.assert();
        publish.assert();
        info.assert();
        assert!(res.public_url.contains("abc"));
    }

    impl YandexClient {
        /// Test-only helper to redirect base URL to mock server.
        fn with_base(mut self, server: &MockServer) -> Self {
            self.client = Client::builder()
                .timeout(Duration::from_secs(5))
                .build()
                .unwrap();
            self.base_url = server.base_url();
            self
        }
    }
}
