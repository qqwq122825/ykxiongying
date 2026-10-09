# 雄鹰安卓远程管理 — 本地 C2 面板（源码包）

打包时间：2026-10-09
来源：C:\Users\Administrator\Desktop\stST\local  （原目录未改动）

## 目录
- front/     Node 单入口门户 server.mjs（静态站 + /m,/api 反代 PHP + /e WS 转发 node-ws + /minicap 转发 dxs）
- site/      1:1 皮肤前端产物（index.html + assets，资源版本 ?v=41/42）
- cs/        ThinkPHP 后端（app/controller/MApiController.php 为 /m/* 适配层）+ route/app.php + node-ws/
    cs/extend/     APK 模板（source.apk 与另外 3 个文件为同一文件的不同命名，MD5 33CD38D8..）+ tf_build.py
    cs/public/     前端产物与静态资源（storage 运行时缓存已剔除）
    cs/node-ws/    设备长连接 + 命令轮询服务
- parts/     适配层分片源码（p1..p6）
- _work/     设备端工具链（dxs.conf / libdxs.so / tpx.bin）
- README.md  原有说明
- dxs_routes.md / sapi_responses.json / *.ps1 / validate*.mjs

## 已剔除（可再生成 / 运行时产物）
logs/  shots/  cs/runtime/  cs/public/storage/  node_modules(python 测试用软链)  __pycache__

## 启动
powershell -NoProfile -ExecutionPolicy Bypass -File start-all.ps1
入口 http://127.0.0.1:8080   账号 admin / admin123

## 本版已修复（2026-10-09）
1. 锁定屏幕：dxs /lockScreen 是空转路由 -> 改用 input keyevent 223
2. 唤醒屏幕：/wakeUpScreen + input keyevent 224 兜底
3. 亮度：面板 0..100 百分比 -> 0..255 原值（下限 25，避免"调暗"变纯黑）
4. 关闭静音：按 payload.muted 走 /unmute
5. 新增 TAKE_SCREENSHOT / FILE_DOWNLOAD / FORCE_STOP_APP / REQUEST_PERMISSION
6. 全命令审计：修前 6 条落死队列，修后 0 条；13/13 标签页正常