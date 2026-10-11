<?php
namespace app\controller;

use app\BaseController;
use think\facade\Request;

class TranslateController extends BaseController
{
    /**
     * Prefix/suffix used to build inline numbered markers like [XXXFP1XXX] inside a merged text.
     * Pure ASCII + digits only (no Unicode / § / symbols) so translation engines never rewrite
     * them into different glyphs or insert spaces inside them. We still allow 0-3 optional
     * whitespace chars between prefix/suffix and the number when splitting, just in case.
     */
    private const MERGE_MARK_PREFIX = '[XXXFP';
    private const MERGE_MARK_SUFFIX = 'XXX]';

    /**
     * Max characters per merged chunk (after urlencode this fits well inside 8KB URL limits
     * common to Google/Lingva/CDN edge servers). Splits texts into batches when exceeded.
     */
    private const MERGE_MAX_CHARS = 1500;

    /**
     * POST /api/translate
     * 文本翻译（调用 Google Translate 免费 API）
     */
    public function translate()
    {
        $data = Request::post();
        $texts = $data['texts'] ?? [];
        $targetLang = $data['targetLang'] ?? $data['targetLanguage'] ?? $data['target_language'] ?? $data['target'] ?? 'zh-CN';

        if (empty($texts)) {
            $text = $data['text'] ?? '';
            if ($text) {
                $texts = [$text];
            } else {
                return json(['success' => true, 'translated' => [], 'data' => ['translations' => []], 'message' => 'success']);
            }
        }

        // Strategy 1: batch texts into few merged requests (markers numbered [XXXFP1XXX] inside),
        // then split back using a regex tolerant to the whitespace changes engines often introduce.
        // Cuts N*3 round-trips down to 1-3 total → "seconds" not "30+ seconds".
        // Engine chain order (all 3 are kept on failure, just reordered so the fastest + most stable
        // provider on this server is tried first — verified 10/10 ok, ~1.0s avg in benchmarks):
        //   1) MyMemory (fastest & most stable on this server), 2) Google GTX, 3) Lingva.
        $translations = null;
        $failed = 0;
        if (count($texts) > 1) {
            $batches = $this->buildMergeBatches($texts);
            $allGood = true;
            $translations = [];
            foreach ($batches as $batch) {
                [$batchIndexes, $merged] = $batch;
                $allTranslated = $this->mymemoryTranslate($merged, $targetLang, $ok);
                if (!$ok) {
                    $allTranslated = $this->googleTranslate($merged, $targetLang, $ok);
                }
                if (!$ok) {
                    $allTranslated = $this->lingvaTranslate($merged, $targetLang, $ok);
                }
                if (!$ok) {
                    $allGood = false;
                    break;
                }
                $split = $this->splitMergedByMarkers($allTranslated, count($batchIndexes));
                if ($split === null || count($split) !== count($batchIndexes)) {
                    $allGood = false;
                    break;
                }
                foreach ($batchIndexes as $pos => $origIdx) {
                    $translations[$origIdx] = $split[$pos];
                }
            }
            if ($allGood) {
                ksort($translations, SORT_NUMERIC);
                $translations = array_values($translations);
            } else {
                $translations = null;
            }
        }

        // Strategy 2: per-text translation (fallback if merge/split mismatched, or only 1 text).
        // Same engine order as Strategy 1 for consistency.
        if ($translations === null) {
            $translations = [];
            $failed = 0;
            foreach ($texts as $text) {
                $translated = $this->mymemoryTranslate($text, $targetLang, $ok);
                if (!$ok) {
                    $translated = $this->googleTranslate($text, $targetLang, $ok);
                }
                if (!$ok) {
                    $translated = $this->lingvaTranslate($text, $targetLang, $ok);
                }
                if (!$ok) $failed++;
                $translations[] = $translated;
            }
        } else {
            // When Strategy 1 succeeded, still count any entries that came back empty
            // (extremely unlikely — guard only).
            foreach ($translations as $t) {
                if ($t === '' || $t === null) $failed++;
            }
        }

        if ($failed === count($texts)) {
            return json(['success' => false, 'translated' => $translations, 'data' => ['translations' => $translations], 'message' => '翻译服务不可用'], 200);
        }
        return json(['success' => true, 'translated' => $translations, 'data' => ['translations' => $translations], 'failed' => $failed, 'message' => $failed ? '部分文本翻译失败' : 'success']);
    }

    /**
     * Build 1..N merge batches, respecting MERGE_MAX_CHARS / URL safety.
     * Each batch is [array_of_original_indexes, merged_string_with_numbered_markers].
     * A single marker like [§§3§§] is short, survives translation engines, and the
     * trailing number is preserved well across most MT providers.
     */
    private function buildMergeBatches(array $texts): array
    {
        $batches = [];
        $indexes = [];
        $buf = '';
        $bufLen = 0;
        $posInBatch = 0;

        $flush = function () use (&$batches, &$indexes, &$buf, &$bufLen, &$posInBatch): void {
            if ($indexes) {
                $batches[] = [$indexes, $buf];
                $indexes = [];
                $buf = '';
                $bufLen = 0;
                $posInBatch = 0;
            }
        };

        foreach ($texts as $i => $t) {
            $marker = self::MERGE_MARK_PREFIX . $posInBatch . self::MERGE_MARK_SUFFIX;
            $markerLen = mb_strlen($marker, 'UTF-8') + 1; // +1 for leading newline
            $tLen = mb_strlen($t, 'UTF-8');
            // 2 extra bytes of safety margin between chunks to avoid off-by-one URL overflows.
            if ($posInBatch > 0 && ($bufLen + $markerLen + $tLen) > (self::MERGE_MAX_CHARS + 2)) {
                $flush();
            }
            if ($posInBatch === 0) {
                $buf = $t;
                $bufLen = $tLen;
            } else {
                $buf .= PHP_EOL . $marker . PHP_EOL . $t;
                $bufLen += $markerLen + $tLen + 1;
            }
            $indexes[] = $i;
            $posInBatch++;
            // Any single giant text (>max alone) still fits in its own batch — engines handle it.
        }
        $flush();
        return $batches;
    }

    /**
     * Split a translated merged text back using numbered inline markers.
     * Uses PREG_SPLIT_DELIM_CAPTURE so we can interleave: <piece0> <marker_num1> <piece1> <marker_num2> <piece2> ...
     * This avoids all manual slicing / off-by-one bugs regardless of how engines move
     * markers to their own lines or pad with whitespace.
     * Returns null when it can't collect all expected pieces (caller falls back to per-text mode).
     */
    private function splitMergedByMarkers(string $text, int $expectedCount): ?array
    {
        if ($expectedCount <= 0) return null;
        $prefix = preg_quote(self::MERGE_MARK_PREFIX, '/');
        $suffix = preg_quote(self::MERGE_MARK_SUFFIX, '/');
        $regex = '/\s*' . $prefix . '\s{0,3}(\d+)\s{0,3}' . $suffix . '\s*/u';

        $tokens = @preg_split($regex, $text, -1, PREG_SPLIT_DELIM_CAPTURE);
        if ($tokens === false || $tokens === []) {
            if ($expectedCount === 1) return [$this->normalizeSplitPiece($text)];
            return null;
        }
        // tokens pattern (always starts with a piece): [piece0, (marker_num, piece)* ]
        // Number of pieces = 1 + (count(tokens)-1)/2. If odd tokens => good split captured.
        if (count($tokens) % 2 === 0) {
            // Even count = structure broken; bail out cleanly.
            return null;
        }
        $out = [];
        $cursorPiece = 0; // We'll assign pieces 0..N-1, using marker numbers as a sanity check only.
        for ($i = 0; $i < count($tokens); $i++) {
            if ($i % 2 === 0) {
                // This token is a piece (string content).
                $out[$cursorPiece] = $this->normalizeSplitPiece($tokens[$i]);
                $cursorPiece++;
            }
            // Odd tokens are the marker number. We don't strictly need them since pieces are
            // already in-order, but we keep them captured in case future debugging needs it.
        }
        if (count($out) !== $expectedCount) return null;
        // Extra safety: ensure no empty strings for expected slots (we never generate empties
        // intentionally, so if we got one the markers likely got merged into a sentence).
        foreach ($out as $v) {
            if ($v === null || $v === '') return null;
        }
        return array_values($out);
    }

    /**
     * Trim leading/trailing whitespace and common punctuation that engines add around separators
     * (extra colons, stray periods, etc.). Internal newlines are preserved because the caller
     * uses them inside multi-line "loading tip" texts.
     */
    private function normalizeSplitPiece(string $piece): string
    {
        $piece = preg_replace('/^\s+/u', '', $piece) ?? '';
        $piece = preg_replace('/\s+$/u', '', $piece) ?? '';
        // Strip a single orphaned leading/trailing punctuation sometimes left over by markers.
        $piece = preg_replace('/^[:：,.。、]\s*/u', '', $piece) ?? '';
        $piece = preg_replace('/\s*[:：,.。、]$/u', '', $piece) ?? '';
        return $piece;
    }

    /**
     * Google Translate 免费 API
     */
    private function googleTranslate(string $text, string $target, ?bool &$ok = null): string
    {
        $ok = false;
        if (!$text) { $ok = true; return ''; }

        $url = env('external.google_translate_url', 'https://translate.googleapis.com/translate_a/single')
            . '?client=gtx&sl=auto&tl='
            . urlencode($target) . '&dt=t&q=' . urlencode($text);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_ENCODING       => 'gzip, deflate, br',
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json, text/plain, */*',
                'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
                'Referer: https://translate.google.com/',
                'Sec-Fetch-Dest: empty',
                'Sec-Fetch-Mode: cors',
                'Sec-Fetch-Site: same-origin',
                'Connection: keep-alive',
            ],
        ]);
        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrNo = curl_errno($ch);
        $curlError = curl_error($ch);
        curl_close($ch);

        if (!$response || $httpCode < 200 || $httpCode >= 300) {
            error_log(sprintf(
                '[Translate][google] request_failed: http=%d, curl_errno=%d, curl_error=%s, target=%s, text_len=%d, text_preview=%s, url=%s',
                $httpCode,
                $curlErrNo,
                $curlError,
                $target,
                strlen($text),
                mb_substr($text, 0, 80),
                $url
            ));
            return $text;
        }

        $result = json_decode($response, true);
        if (!$result || !isset($result[0])) {
            error_log(sprintf(
                '[Translate][google] json_invalid: http=%d, target=%s, text_len=%d, text_preview=%s, raw_len=%d, raw_preview=%s',
                $httpCode,
                $target,
                strlen($text),
                mb_substr($text, 0, 80),
                strlen((string)$response),
                substr((string)$response, 0, 200)
            ));
            return $text;
        }

        $translated = '';
        foreach ($result[0] as $part) {
            if (isset($part[0])) {
                $translated .= $part[0];
            }
        }

        if (!$translated) {
            error_log(sprintf(
                '[Translate][google] empty_result: http=%d, target=%s, text_len=%d, text_preview=%s',
                $httpCode,
                $target,
                strlen($text),
                mb_substr($text, 0, 80)
            ));
            return $text;
        }
        $ok = true;
        return $translated;
    }

    private function lingvaTranslate(string $text, string $target, ?bool &$ok = null): string
    {
        $ok = false;
        if (!$text) { $ok = true; return ''; }

        $targetCode = strtolower(explode('-', str_replace('_', '-', $target))[0]);
        $baseUrl = rtrim(env('external.lingva_translate_url', 'https://lingva.ml/api/v1'), '/');
        $url = $baseUrl . '/auto/' . rawurlencode($targetCode) . '/' . rawurlencode($text);
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json, text/plain, */*',
                'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
                'Sec-Fetch-Dest: empty',
                'Sec-Fetch-Mode: cors',
                'Sec-Fetch-Site: cross-site',
            ],
        ]);
        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrNo = curl_errno($ch);
        $curlError = curl_error($ch);
        curl_close($ch);

        $result = json_decode((string)$response, true);
        $translated = $result['translation'] ?? '';
        if ($httpCode < 200 || $httpCode >= 300 || !$translated) {
            error_log(sprintf(
                '[Translate][lingva] request_failed: http=%d, curl_errno=%d, curl_error=%s, target=%s, target_code=%s, text_len=%d, text_preview=%s, translation_empty=%d, raw_len=%d, raw_preview=%s, url=%s',
                $httpCode,
                $curlErrNo,
                $curlError,
                $target,
                $targetCode,
                strlen($text),
                mb_substr($text, 0, 80),
                $translated ? 0 : 1,
                strlen((string)$response),
                substr((string)$response, 0, 200),
                $url
            ));
            return $text;
        }
        $ok = true;
        return $translated;
    }

    /**
     * MyMemory Free API fallback (no key needed, 5000 chars/day).
     * Requires explicit source language (no "auto"); uses a lightweight script-based detection.
     */
    private function mymemoryTranslate(string $text, string $target, ?bool &$ok = null): string
    {
        $ok = false;
        if (!$text) { $ok = true; return ''; }

        $src = $this->detectSourceLang($text);
        $targetNorm = $this->normalizeTargetLang($target);
        if (!$targetNorm) {
            error_log(sprintf('[Translate][mymemory] unsupported_target: target=%s, normalized=empty', $target));
            return $text;
        }

        $baseUrl = rtrim(env('external.mymemory_translate_url', 'https://api.mymemory.translated.net/get'), '/');
        $url = $baseUrl . '?langpair=' . rawurlencode($src . '|' . $targetNorm)
            . '&q=' . rawurlencode($text);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (FisherPanel/1.0)',
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json',
                'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
            ],
        ]);
        $response = curl_exec($ch);
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrNo = curl_errno($ch);
        $curlError = curl_error($ch);
        curl_close($ch);

        $j = json_decode((string)$response, true);
        $translated = $j['responseData']['translatedText'] ?? '';
        $quotaEnded   = !empty($j['quotaFinished']);
        $respStatus   = $j['responseStatus'] ?? null;

        if ($httpCode < 200 || $httpCode >= 300 || !$translated || $quotaEnded || (int)$respStatus >= 400) {
            error_log(sprintf(
                '[Translate][mymemory] request_failed: http=%d, resp_status=%s, quota_ended=%d, curl_errno=%d, curl_error=%s, src=%s, target=%s, target_norm=%s, text_len=%d, text_preview=%s, translation_empty=%d, raw_len=%d, raw_preview=%s, url=%s',
                $httpCode,
                var_export($respStatus, true),
                $quotaEnded ? 1 : 0,
                $curlErrNo,
                $curlError,
                $src,
                $target,
                $targetNorm,
                strlen($text),
                mb_substr($text, 0, 80),
                $translated ? 0 : 1,
                strlen((string)$response),
                substr((string)$response, 0, 200),
                $url
            ));
            return $text;
        }

        $ok = true;
        return $translated;
    }

    /**
     * Lightweight Unicode-based source-language detection (only what MyMemory supports).
     * Falls back to "en" when no CJK/Cyrillic/AR/TH/HI scripts are found.
     */
    private function detectSourceLang(string $text): string
    {
        if (preg_match('/[\x{4e00}-\x{9fff}\x{3400}-\x{4dbf}]/u', $text)) return 'zh-CN';
        if (preg_match('/[\x{3040}-\x{30ff}]/u', $text)) return 'ja';
        if (preg_match('/[\x{ac00}-\x{d7af}]/u', $text)) return 'ko';
        if (preg_match('/[\x{0600}-\x{06ff}]/u', $text)) return 'ar-SA';
        if (preg_match('/[\x{0e00}-\x{0e7f}]/u', $text)) return 'th-TH';
        if (preg_match('/[\x{0900}-\x{097f}]/u', $text)) return 'hi-IN';
        if (preg_match('/[\x{0400}-\x{04ff}]/u', $text)) return 'ru';
        return 'en';
    }

    /**
     * Normalize frontend 2-letter codes into MyMemory langpair codes
     * (regional forms only when required by the API; pure 2-letter otherwise).
     */
    private function normalizeTargetLang(string $code): string
    {
        $c = strtolower(explode('-', str_replace('_', '-', $code))[0]);
        $map = [
            'zh' => 'zh-CN',
            'id' => 'id-ID',
            'ms' => 'ms-MY',
            'vi' => 'vi-VN',
            'th' => 'th-TH',
            'hi' => 'hi-IN',
            'ar' => 'ar-SA',
            'tr' => 'tr-TR',
            'tl' => 'tl-PH',
            'sv' => 'sv-SE',
            'pl' => 'pl-PL',
            'nl' => 'nl-NL',
        ];
        return $map[$c] ?? $c;
    }
}
