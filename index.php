<?php
// XAMPP entry: http://localhost/dashboard -> http://localhost/dashboard/frontend/
// The frontend is a static SPA; the API is served by Node on :2020 (run start.bat / node server.js).
header('Location: frontend/', true, 302);
?>
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=frontend/"><title>Redirecting…</title></head>
<body><p>Redirecting to <a href="frontend/">frontend/</a>…</p></body></html>
