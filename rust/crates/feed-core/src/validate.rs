use chrono::NaiveTime;

use crate::{FeedConfig, Plan};

#[derive(Debug)]
pub enum PlanValidationError {
    EmptyPlan,
    PublicationQueueMissing,
    CountsMismatch(String),
    TimeWindowViolation(String),
    StepViolation(String),
}

/// Проверка количества: tasks vs publicationQueue (по materialId+address).
pub fn validate_plan_counts(plan: &Plan) -> Result<(), PlanValidationError> {
    use std::collections::HashMap;
    let aliases = plan.aliases.as_ref();

    let mut task_counts: HashMap<(String, String), u32> = HashMap::new();
    for task in &plan.tasks {
        let material_id = resolve_material_alias(task.material_id.clone(), aliases);
        let locations = if !task.locations.is_empty() {
            task.locations.clone()
        } else {
            task.addresses.clone().unwrap_or_default()
        };
        for loc in locations {
            let count = loc.count.max(task.count);
            if count == 0 {
                continue;
            }
            let address = resolve_address_alias(loc.address, aliases);
            *task_counts.entry((material_id.clone(), address)).or_default() += count;
        }
    }

    let mut queue_counts: HashMap<(String, String), u32> = HashMap::new();
    for item in &plan.publication_queue {
        let material_id = resolve_material_alias(
            if !item.material_id.is_empty() {
                item.material_id.clone()
            } else {
                item.material.clone().unwrap_or_default()
            },
            aliases,
        );
        let address = resolve_address_alias(item.location.clone(), aliases);
        *queue_counts.entry((material_id, address)).or_default() += 1;
    }

    let mut diff = Vec::new();
    for key in task_counts.keys().chain(queue_counts.keys()) {
        let task_cnt = *task_counts.get(key).unwrap_or(&0);
        let queue_cnt = *queue_counts.get(key).unwrap_or(&0);
        if task_cnt != queue_cnt {
            diff.push((key.clone(), task_cnt, queue_cnt));
        }
    }
    if !diff.is_empty() {
        let sample: Vec<String> = diff
            .iter()
            .take(10)
            .map(|((mat, addr), t, q)| format!("  {} @ {}: tasks={}, queue={}", mat, addr, t, q))
            .collect();
        let tail = if diff.len() > 10 { "\n  ..." } else { "" };
        return Err(PlanValidationError::CountsMismatch(format!(
            "План не совпадает с publicationQueue по количеству объявлений:\n{}{}",
            sample.join("\n"),
            tail
        )));
    }
    Ok(())
}

/// Проверка попадания DateBegin в разрешённые окна времени.
pub fn validate_plan_windows(plan: &Plan, cfg: &FeedConfig) -> Result<(), PlanValidationError> {
    if plan.publication_queue.is_empty() {
        return Ok(());
    }
    let windows: Vec<(NaiveTime, NaiveTime)> = cfg
        .time_windows
        .iter()
        .filter_map(|w| {
            let parse = |s: &str| NaiveTime::parse_from_str(s, "%H:%M").ok();
            match (parse(&w.start), parse(&w.end)) {
                (Some(s), Some(e)) => Some((s, e)),
                _ => None,
            }
        })
        .collect();
    let mut bad = Vec::new();
    for (idx, item) in plan.publication_queue.iter().enumerate() {
        let dt = parse_date_time(&item.date_begin);
        if dt.is_none() {
            bad.push((idx + 1, item.material_id.clone(), item.location.clone(), item.date_begin.clone()));
            continue;
        }
        let dt = dt.unwrap();
        let t = dt.time();
        let in_window = windows.iter().any(|(s, e)| t >= *s && t <= *e);
        if !in_window {
            bad.push((idx + 1, item.material_id.clone(), item.location.clone(), item.date_begin.clone()));
        }
    }
    if !bad.is_empty() {
        let sample: Vec<String> = bad
            .iter()
            .take(10)
            .map(|(i, m, loc, d)| format!("  #{}: {} @ {} -> {}", i, m, loc, d))
            .collect();
        let tail = if bad.len() > 10 { "\n  ..." } else { "" };
        return Err(PlanValidationError::TimeWindowViolation(format!(
            "DateBegin вне допустимых окон. Исправьте publicationQueue.\n{}{}",
            sample.join("\n"),
            tail
        )));
    }
    Ok(())
}

/// Проверка шага между публикациями в рамках окна (мин/макс), учитывает переход между окнами.
pub fn validate_plan_step_intervals(plan: &Plan, cfg: &FeedConfig) -> Result<(), PlanValidationError> {
    if plan.publication_queue.len() < 2 {
        return Ok(());
    }
    let min_minutes = cfg.min_step_minutes;
    let max_minutes = cfg.max_step_minutes;
    let mut bad = Vec::new();
    let windows: Vec<(NaiveTime, NaiveTime)> = cfg
        .time_windows
        .iter()
        .filter_map(|w| {
            let parse = |s: &str| NaiveTime::parse_from_str(s, "%H:%M").ok();
            match (parse(&w.start), parse(&w.end)) {
                (Some(s), Some(e)) => Some((s, e)),
                _ => None,
            }
        })
        .collect();

    let window_name = |t: NaiveTime| -> Option<usize> {
        for (idx, (s, e)) in windows.iter().enumerate() {
            if t >= *s && t <= *e {
                return Some(idx);
            }
        }
        None
    };

    let slots = &plan.publication_queue;
    for i in 1..slots.len() {
        let prev_dt = parse_date_time(&slots[i - 1].date_begin);
        let curr_dt = parse_date_time(&slots[i].date_begin);
        if prev_dt.is_none() || curr_dt.is_none() {
            bad.push((i + 1, slots[i - 1].date_begin.clone(), slots[i].date_begin.clone(), "n/a".to_string()));
            continue;
        }
        let prev_dt = prev_dt.unwrap();
        let curr_dt = curr_dt.unwrap();
        let diff_min = (curr_dt - prev_dt).num_minutes();
        let prev_w = window_name(prev_dt.time());
        let curr_w = window_name(curr_dt.time());
        let windows_differ = prev_w.is_some() && curr_w.is_some() && prev_w != curr_w;

        if windows_differ {
            if diff_min < min_minutes as i64 {
                bad.push((i + 1, slots[i - 1].date_begin.clone(), slots[i].date_begin.clone(), diff_min.to_string()));
            }
            continue;
        }
        if diff_min < min_minutes as i64 || diff_min > max_minutes as i64 {
            bad.push((i + 1, slots[i - 1].date_begin.clone(), slots[i].date_begin.clone(), diff_min.to_string()));
        }
    }

    if !bad.is_empty() {
        let sample: Vec<String> = bad
            .iter()
            .take(10)
            .map(|(i, prev, curr, diff)| format!("  #{}: {} -> {} (Δ={} мин)", i, prev, curr, diff))
            .collect();
        let tail = if bad.len() > 10 { "\n  ..." } else { "" };
        return Err(PlanValidationError::StepViolation(format!(
            "Шаг между публикациями вне допустимых границ ({}–{} минут).\n{}{}",
            min_minutes,
            max_minutes,
            sample.join("\n"),
            tail
        )));
    }
    Ok(())
}

/// Парсинг даты/времени "DD.MM.YYYY HH:MM".
pub fn parse_date_time(s: &str) -> Option<chrono::NaiveDateTime> {
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%d.%m.%Y %H:%M") {
        return Some(dt);
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%d.%m.%Y") {
        return Some(d.and_hms_opt(0, 0, 0)?);
    }
    None
}

fn resolve_material_alias(id: String, aliases: Option<&crate::Aliases>) -> String {
    if let Some(a) = aliases {
        if let Some(mapped) = a.materials.get(&id) {
            return mapped.clone();
        }
    }
    id
}

fn resolve_address_alias(addr: String, aliases: Option<&crate::Aliases>) -> String {
    if let Some(a) = aliases {
        if let Some(mapped) = a.addresses.get(&addr) {
            return mapped.clone();
        }
    }
    addr
}
