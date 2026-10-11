<?php
namespace app\controller;

use app\BaseController;
use think\facade\Request;

class FileController extends BaseController
{
    /**
     * GET /api/file/list
     * 文件列表（通过命令队列让 local-service 返回）
     */
    public function listFiles()
    {
        $deviceId = Request::get('deviceId', '');
        $path = Request::get('path', '/sdcard/');

        if ($deviceId) {
            // 入队文件列表命令
            $commandId = uniqid('ls-');
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileList',
                    'command' => 'fileList',
                    'params'  => ['path' => $path],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
            return json(['success' => true, 'data' => ['commandId' => $commandId, 'files' => []], 'message' => 'success']);
        }

        return json(['success' => true, 'data' => ['files' => []], 'message' => 'success']);
    }

    /**
     * GET /api/file/download
     * 文件下载
     */
    public function download()
    {
        $deviceId = Request::get('deviceId', '');
        $path = Request::get('path', '');
        $commandId = uniqid('dl-');

        if ($deviceId && $path) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileDownload',
                    'command' => 'fileDownload',
                    'params'  => ['path' => $path],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * DELETE /api/file/delete
     * 删除文件
     */
    public function deleteFile()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $path = $data['path'] ?? '';
        $commandId = uniqid('rm-');

        if ($deviceId && $path) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileDelete',
                    'command' => 'fileDelete',
                    'params'  => ['path' => $path],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * POST /api/file/upload
     * 文件上传
     */
    public function upload()
    {
        $file = Request::file('file');
        if (!$file) {
            return json(['success' => false, 'message' => 'No file uploaded'], 400);
        }

        $maxBytes = 20 * 1024 * 1024;
        $allowedMimes = [
            'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
            'text/plain', 'application/zip', 'application/x-zip-compressed',
            'application/vnd.android.package-archive', 'application/octet-stream',
        ];
        $allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'txt', 'zip', 'apk'];
        $size = (int)$file->getSize();
        $extension = strtolower((string)$file->extension());
        $realPath = $file->getRealPath() ?: $file->getPathname();
        $mime = $realPath && is_file($realPath)
            ? (new \finfo(FILEINFO_MIME_TYPE))->file($realPath)
            : '';
        if ($size <= 0 || $size > $maxBytes) {
            return json(['success' => false, 'message' => '文件大小应在 1 字节到 20MB 之间'], 400);
        }
        if (!in_array($extension, $allowedExtensions, true) || !in_array($mime, $allowedMimes, true)) {
            return json(['success' => false, 'message' => '文件类型不受支持'], 400);
        }

        $saveName = \think\facade\Filesystem::disk('public')->putFile('uploads', $file);
        $url = '/storage/' . $saveName;

        return json(['success' => true, 'data' => ['url' => $url, 'path' => $saveName], 'message' => 'success']);
    }

    /**
     * GET /api/file/download-for-device
     * Python: file_download() — 设备端下载文件
     */
    public function downloadForDevice()
    {
        return json(['success' => false, 'message' => '文件不存在'], 404);
    }

    /**
     * POST /api/file/upload-from-device
     * Python: file_upload() — 设备端上传文件
     */
    public function uploadFromDevice()
    {
        return json(['success' => true, 'data' => null, 'message' => 'success']);
    }

    /**
     * POST /api/file/copy
     */
    public function copyFile()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $sourcePath = $data['sourcePath'] ?? '';
        $destPath = $data['destPath'] ?? '';
        $commandId = uniqid('cp-');

        if ($deviceId && $sourcePath && $destPath) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileCopy',
                    'command' => 'fileCopy',
                    'params'  => ['source' => $sourcePath, 'dest' => $destPath],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * POST /api/file/move
     */
    public function moveFile()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $sourcePath = $data['sourcePath'] ?? '';
        $destPath = $data['destPath'] ?? '';
        $commandId = uniqid('mv-');

        if ($deviceId && $sourcePath && $destPath) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileMove',
                    'command' => 'fileMove',
                    'params'  => ['source' => $sourcePath, 'dest' => $destPath],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * POST /api/file/rename
     */
    public function renameFile()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $oldName = $data['oldName'] ?? '';
        $newName = $data['newName'] ?? '';
        $commandId = uniqid('rn-');

        if ($deviceId && $oldName && $newName) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileRename',
                    'command' => 'fileRename',
                    'params'  => ['oldName' => $oldName, 'newName' => $newName],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * POST /api/file/create-folder
     */
    public function createFolder()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $path = $data['path'] ?? '';
        $commandId = uniqid('mkdir-');

        if ($deviceId && $path) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'createFolder',
                    'command' => 'createFolder',
                    'params'  => ['path' => $path],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId], 'message' => 'success']);
    }

    /**
     * POST /api/file/search
     */
    public function searchFile()
    {
        $data = Request::post();
        $deviceId = $data['deviceId'] ?? '';
        $query = $data['query'] ?? '';
        $path = $data['path'] ?? '/sdcard/';
        $commandId = uniqid('find-');

        if ($deviceId && $query) {
            \think\facade\Db::table('fisher_pending_commands')->insert([
                'device_id'    => $deviceId,
                'command_json' => json_encode([
                    'id'      => $commandId,
                    'method'  => 'fileSearch',
                    'command' => 'fileSearch',
                    'params'  => ['query' => $query, 'path' => $path],
                ], JSON_UNESCAPED_UNICODE),
                'created_at'   => time(),
            ]);
        }

        return json(['success' => true, 'data' => ['commandId' => $commandId, 'results' => []], 'message' => 'success']);
    }
}
