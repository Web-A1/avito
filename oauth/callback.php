<?php
// Простая страница для приёма кода из OAuth-редиректа Avito.
$query = $_GET;
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Avito OAuth Callback</title>
  <style>
    body { font-family: sans-serif; padding: 32px; line-height: 1.5; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 4px; }
    pre { background: #f8f8f8; padding: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Avito OAuth Callback</h1>
  <p>Скопируйте параметр <code>code</code> и передайте его в обмен на токен.</p>
  <?php if (!empty($query)): ?>
    <h3>Параметры запроса:</h3>
    <pre><?php echo htmlspecialchars(json_encode($query, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), ENT_QUOTES, 'UTF-8'); ?></pre>
  <?php else: ?>
    <p>Параметры не переданы.</p>
  <?php endif; ?>
</body>
</html>
