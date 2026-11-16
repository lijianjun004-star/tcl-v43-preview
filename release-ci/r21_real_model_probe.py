#!/usr/bin/env python3
"""Read-only R2.1 public-site runtime smoke: REAL downloaded model, NON-SPEECH test tone.
No user audio, credentials, Pages writes, synthetic "correct" transcript, or API key.
"""
import base64
import io
import json
import math
import re
import urllib.request
import struct
import sys
import time
import traceback
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-autoqa-r2/"
REPORT = Path("r21_real_whisper_runtime_result.json")
MANDARIN_SAMPLE_URL = "https://isv-data.oss-cn-hangzhou.aliyuncs.com/ics/MaaS/ASR/test_audio/BAC009S0764W0121.wav"
MANDARIN_REFERENCE = "甚至出现交易几乎停滞的情况"  # QwenAudio/SenseVoice documented sample


def download_public_mandarin_sample():
    req = urllib.request.Request(MANDARIN_SAMPLE_URL, headers={"User-Agent":"TCL-ASR-Noncommercial-QA/1"})
    with urllib.request.urlopen(req, timeout=23) as resp:
        data = resp.read(2 * 1024 * 1024 + 1)
    if not (44 <= len(data) <= 2 * 1024 * 1024 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"):
        raise ValueError("Public Mandarin sample is not expected bounded RIFF/WAVE")
    return base64.b64encode(data).decode("ascii")


def normalize_text(value):
    return re.sub(r"[^a-z0-9\\u4e00-\\u9fff]", "", str(value).lower())


def edit_distance(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j-1] + 1, previous[j-1] + (x != y)))
        previous = current
    return previous[-1]



def generated_wav():
    hz = 16000
    frames = bytearray()
    for i in range(hz * 2):
        amp = int(5200 * math.sin(2 * math.pi * 440 * i / hz))
        frames += struct.pack("<h", amp)
    b = io.BytesIO()
    with wave.open(b, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(hz)
        out.writeframes(frames)
    return base64.b64encode(b.getvalue()).decode("ascii")


def run():
    report = {
        "mode": "REAL ONNX/Whisper pipeline; synthetic non-speech sine wave; no speech accuracy claim",
        "url": URL,
        "ok": False,
        "console_errors": [],
        "page_errors": [],
        "failed_requests": [],
        "stage": "initialize",
    }
    t0 = time.monotonic()
    mandarin_audio = None
    report["mandarin_reference"] = MANDARIN_REFERENCE
    report["mandarin_reference_source"] = "QwenAudio/SenseVoice README (published public sample)"
    try:
        mandarin_audio = download_public_mandarin_sample()
        report["mandarin_sample_download"] = "PASS"
    except Exception as err:
        report["mandarin_sample_download"] = "NOT RUN: " + str(err)[:250]
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required",
            ])
            try:
                page = browser.new_page(viewport={"width": 390, "height": 844})
                page.set_default_timeout(340000)
                page.on("pageerror", lambda e: report["page_errors"].append(str(e)[:600]) if len(report["page_errors"]) < 20 else None)
                page.on("console", lambda m: report["console_errors"].append(m.text[:600]) if m.type == "error" and len(report["console_errors"]) < 20 else None)
                page.on("requestfailed", lambda req: report["failed_requests"].append({"url": req.url[:350], "failure": req.failure}) if len(report["failed_requests"]) < 30 else None)
                response = page.goto(URL, wait_until="domcontentloaded", timeout=55000)
                report["http_status"] = response.status if response else None
                report["title"] = page.title()
                report["stage"] = "real_model"
                outcome = page.evaluate(r"""async ({ wav, mandarin }) => {
                  const started = performance.now();
                  const progress = [];
                  try {
                    const {createLocalWhisper} = await import('./whisper-bridge.mjs');
                    progress.push("imported_local_bridge");
                    const data = Uint8Array.from(atob(wav), c => c.charCodeAt(0));
                    const blob = new Blob([data], {type:'audio/wav'});
                    const transcribe = createLocalWhisper({
                      onProgress:(s)=>{if(progress.length<45) progress.push(String(s));},
                      loadTimeoutMs: 170000,
                      inferTimeoutMs: 95000
                    });
                    // Sine is only to exercise the real model. Its output is NOT evaluated for accuracy.
                    const ans = await transcribe(blob);
                    let mandarinResult = {status:'NOT RUN: audio source unavailable'};
                    if(mandarin){
                      try{
                        const zhAudio = Uint8Array.from(atob(mandarin),c=>c.charCodeAt(0));
                        const spoken = await transcribe(new Blob([zhAudio],{type:'audio/wav'}));
                        mandarinResult={status:'PASS: real Whisper inference completed',
                           text:String(spoken?.text??''),duration:spoken?.duration,rms:spoken?.rms};
                      }catch(e){
                        mandarinResult={status:'FAIL',error:String(e?.message||e)};
                      }
                    }
                    return {ok: typeof ans?.text === 'string',
                            text_type: typeof ans?.text, text_length: String(ans?.text ?? '').length,
                            duration: ans?.duration, rms:ans?.rms,
                            mandarin:mandarinResult,
                            progress, elapsed_ms:Math.round(performance.now()-started)};
                  } catch(err) {
                    return {ok:false, error:String(err?.message||err),
                            stack:String(err?.stack||'').slice(0,2200),
                            progress, elapsed_ms:Math.round(performance.now()-started)};
                  }
                }""", {"wav": generated_wav(), "mandarin": mandarin_audio})
                report["inference"] = outcome
                spoken = outcome.get("mandarin") or {}
                if spoken.get("status", "").startswith("PASS"):
                    a = normalize_text(MANDARIN_REFERENCE)
                    b = normalize_text(spoken.get("text", ""))
                    report["mandarin_single_sample_CER"] = round(edit_distance(a,b) / max(1,len(a)), 4)
                    report["mandarin_accuracy_note"] = "One public Mandarin sample, not TCL product speech or a calibrated benchmark"
                report["ok"] = bool(outcome.get("ok")) and report["http_status"] == 200
                report["stage"] = "finished"
            finally:
                browser.close()
    except Exception as exc:
        report["exception"] = str(exc)[:1800]
        report["traceback"] = traceback.format_exc()[-2300:]
    finally:
        report["elapsed_seconds"] = round(time.monotonic() - t0, 2)
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("R21_REAL_WHISPER_RUNTIME_PROBE", json.dumps(report, ensure_ascii=False)[:9000])
    return report["ok"]


if __name__ == "__main__":
    sys.exit(0 if run() else 2)
