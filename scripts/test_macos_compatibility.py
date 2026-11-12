"""Synthetic Mach-O and evidence tests; no app execution or private data."""
import copy
import importlib.util
import json
import os
import plistlib
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("frame_compat", Path(__file__).with_name("verify-macos-compatibility.py"))
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)


def native(minimum=(13, 0, 0), cpu=0x100000c, subtype=0, dependency="/usr/lib/libSystem.B.dylib"):
    packed = minimum[0] << 16 | minimum[1] << 8 | minimum[2]
    build = struct.pack("<IIIIII", 0x32, 24, 1, packed, packed, 0)
    string = dependency.encode() + b"\0"
    length = (24 + len(string) + 7) // 8 * 8
    dylib = struct.pack("<IIIIII", 0xc, length, 24, 0, 0, 0) + string.ljust(length - 24, b"\0")
    return struct.pack("<IiiIIIII", 0xfeedfacf, cpu, subtype, 2, 2, len(build + dylib), 0, 0) + build + dylib


class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.app = self.root / "Frame Studio.app"
        (self.app / "Contents/MacOS").mkdir(parents=True)
        self.executable = self.app / "Contents/MacOS/frame-studio"
        self.executable.write_bytes(native())
        self.executable.chmod(0o755)
        self.info = self.app / "Contents/Info.plist"
        self.info.write_bytes(plistlib.dumps({"CFBundleExecutable": "frame-studio", "CFBundleShortVersionString": "2.0.0-rc.1", "LSMinimumSystemVersion": "13.0"}))

    def tearDown(self):
        self.temporary.cleanup()

    def report(self):
        return compat.inspect_bundle(self.app, "13.0", "2.0.0-rc.1")

    def evidence(self):
        report = self.report()
        return {"schema_version": 1, "method": "manual_gui", "artifact": {key: report["artifact"][key] for key in ("executable_sha256", "bundle_sha256")}, "environment": {"hardware_arch": "arm64", "process_arch": "arm64", "chip": "Apple M2 Max", "macos_version": "13.4", "macos_build": "22F2063"}, "checks": {name: {"status": "pass" if name == "gui_launch" else "not_run", "reason": "observed" if name == "gui_launch" else "not_observed"} for name in compat.RUNTIME_CHECKS}}

    def test_reads_real_architecture_and_minimum_load_command(self):
        rows = compat.read_native(self.executable)
        self.assertEqual(rows[0]["architecture"], "arm64")
        self.assertEqual(rows[0]["minimum_os"], "13.0.0")
        report = self.report()
        for name in ("bundle_structure", "native_architecture", "native_minimum", "runtime_dependencies"):
            self.assertEqual(report["checks"][name]["status"], "pass")

    def test_lowering_plist_does_not_hide_newer_binary_target(self):
        self.executable.write_bytes(native((14, 0, 0)))
        self.assertEqual(self.report()["checks"]["native_minimum"]["status"], "fail")

    def test_wrong_architecture_and_arm64e_only_are_rejected(self):
        for cpu, subtype in ((0x1000007, 3), (0x100000c, 2)):
            self.executable.write_bytes(native(cpu=cpu, subtype=subtype))
            self.assertEqual(self.report()["checks"]["native_architecture"]["status"], "fail")

    def test_scans_native_extensions_with_unusual_names(self):
        module = self.app / "Contents/resource.unusual"
        module.write_bytes(native((15, 0, 0)))
        self.assertEqual(len(self.report()["native_files"]), 2)
        self.assertEqual(self.report()["checks"]["native_minimum"]["status"], "fail")

    def test_external_developer_dependency_is_rejected(self):
        self.executable.write_bytes(native(dependency="/opt/homebrew/private/libimage.dylib"))
        self.assertEqual(self.report()["checks"]["runtime_dependencies"]["status"], "fail")

    def test_bundled_loader_relative_dependency_is_accepted(self):
        library = self.app / "Contents/MacOS/libimage.dylib"
        library.write_bytes(native())
        self.executable.write_bytes(native(dependency="@loader_path/libimage.dylib"))
        self.assertEqual(self.report()["checks"]["runtime_dependencies"]["status"], "pass")

    def test_relative_links_cannot_escape_the_bundle(self):
        os.symlink("../../../private", self.app / "Contents/escape")
        self.assertEqual(self.report()["checks"]["bundle_links"]["status"], "fail")

    def test_rejects_truncated_and_invalid_native_commands(self):
        for payload in (native()[:20], native()[:40], native()[:32] + struct.pack("<II", 0xc, 0) + native()[40:]):
            self.executable.write_bytes(payload)
            with self.assertRaises((ValueError, struct.error)):
                compat.read_native(self.executable)

    def test_fat_binary_checks_each_slice(self):
        a, b = native(), native(cpu=0x1000007, subtype=3)
        table = struct.pack(">II", 0xcafebabe, 2) + struct.pack(">iiIII", 0x100000c, 0, 48, len(a), 0) + struct.pack(">iiIII", 0x1000007, 3, 48 + len(a), len(b), 0)
        self.executable.write_bytes(table + a + b)
        self.assertEqual([row["architecture"] for row in compat.read_native(self.executable)], ["arm64", "x86_64"])
        self.assertEqual(self.report()["checks"]["native_architecture"]["status"], "pass")

    def test_no_runtime_pass_is_inferred_from_static_checks(self):
        for name in compat.RUNTIME_CHECKS:
            self.assertEqual(self.report()["checks"][name]["status"], "not_run")

    def test_runtime_evidence_binds_entire_bundle_and_preserves_limits(self):
        report, evidence = self.report(), self.evidence()
        compat.apply_runtime_evidence(report, evidence)
        self.assertEqual(report["checks"]["gui_launch"]["status"], "pass")
        self.assertEqual(report["checks"]["archive_import"]["status"], "not_run")
        self.assertTrue(report["runtime"][0]["human_attestation"])
        (self.app / "Contents/additional-resource").write_text("new bytes")
        with self.assertRaises(ValueError):
            compat.apply_runtime_evidence(self.report(), evidence)

    def test_invalid_runtime_or_private_fields_are_rejected(self):
        for change in (lambda e: e["environment"].update(username="private"), lambda e: e.update(method="compiled_module"), lambda e: e["checks"].update(gui_launch="pass"), lambda e: e["environment"].update(chip="/Users/private"), lambda e: e["checks"]["gui_launch"].update(reason="/Users/private")):
            evidence = self.evidence(); change(evidence)
            with self.assertRaises(ValueError):
                compat.apply_runtime_evidence(self.report(), evidence)

    def test_runtime_cannot_bind_missing_or_invalid_digests(self):
        evidence = self.evidence()
        for value in (None, "", "unknown", "a" * 63):
            evidence["artifact"]["bundle_sha256"] = value
            with self.assertRaises(ValueError):
                compat.apply_runtime_evidence(self.report(), evidence)

    def test_failed_machine_is_not_erased_by_subsequent_pass(self):
        report, evidence = self.report(), self.evidence()
        evidence["checks"]["archive_import"] = {"status": "fail", "reason": "actual_failure"}
        compat.apply_runtime_evidence(report, evidence)
        evidence = copy.deepcopy(evidence); evidence["checks"]["archive_import"] = {"status": "pass", "reason": "another_machine_pass"}
        compat.apply_runtime_evidence(report, evidence)
        self.assertEqual(report["checks"]["archive_import"]["status"], "fail")
        self.assertEqual(len(report["runtime"]), 2)

    def test_quarantine_flags_are_parsed_without_recording_source_metadata(self):
        raw = "0187;source-private;private-account;private-uuid".encode().hex()
        with patch.object(compat, "run", return_value=(0, raw)):
            row = compat.quarantine(self.app)
        self.assertEqual(row["status"], "fail"); self.assertEqual(row["reason"], "hard_quarantine")
        self.assertNotIn("private", json.dumps(row))
        with patch.object(compat, "run", return_value=(1, "xattr: No such xattr: com.apple.quarantine")):
            self.assertIn("inherited_state_unknown", compat.quarantine(self.app)["reason"])

    def test_reports_are_exclusive_and_contain_no_development_path(self):
        output = self.root / "reports"
        report = self.report(); compat.write_report(report, output)
        self.assertEqual(report["summary"], "not_run")
        self.assertNotIn(str(self.root), (output / "compatibility.json").read_text())
        with self.assertRaises(FileExistsError):
            compat.write_report(report, output)

    def test_receiver_script_syntax_and_help_need_no_python(self):
        script = Path(__file__).with_name("collect-mac-diagnostics.command")
        import subprocess
        subprocess.run(["/bin/zsh", "-n", str(script)], check=True, capture_output=True)
        result = subprocess.run(["/bin/zsh", str(script), "--help"], check=True, capture_output=True, text=True)
        self.assertIn("不启动应用", result.stdout)


if __name__ == "__main__":
    unittest.main()
