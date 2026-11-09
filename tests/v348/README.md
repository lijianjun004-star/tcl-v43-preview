# V3.4.8 targeted regression tests

These tests exercise the unpacked candidate, not this branch's historical site.zip. Serve the unpacked ZIP root over HTTP on localhost:8765, set TCL_URL to its /tcl-specialty-v33/ URL if needed, and run the Node scripts with Playwright and Chromium installed. Run `node v348-barrage-test.cjs /path/to/tcl-specialty-v33/app.js` and `python test_v348_ui.py /path/to/tcl-specialty-v33`. Browser tests use injected test hooks, mock recognition, audio decoding and synthetic events. They are not real device, real model, authentication or cross-device tests.

The release gate permits only site.zip and the pinned workflow checksum in a release PR, so the reproducible tests are kept on this dedicated evidence branch and must be run against the exact candidate ZIP.
