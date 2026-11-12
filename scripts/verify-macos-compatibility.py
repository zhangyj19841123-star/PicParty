#!/usr/bin/env python3
"""Read-only development preflight. Uses Python's standard library only.

This never launches an app, changes quarantine/signatures/permissions, modifies
inputs, installs tools, connects to another computer or collects private files.
Receiver diagnostics use collect-mac-diagnostics.command without Python.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import plistlib
import re
import stat
import struct
import subprocess
from pathlib import Path

NATIVE_MAGICS = {b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
RUNTIME_CHECKS = ("gui_launch", "project_read_write", "missing_assets", "archive_import", "export")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def version_tuple(value: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", value):
        raise ValueError("invalid_version")
    values = tuple(map(int, value.split(".")))
    return values + (0,) * (4 - len(values))


def packed_version(value: int) -> str:
    return f"{value >> 16}.{value >> 8 & 255}.{value & 255}"


def read_native(path: Path) -> list[dict]:
    """Inspect bounded load commands of thin/fat Mach-O, not filename suffixes."""
    data = path.read_bytes()

    def thin(offset: int, size: int) -> dict:
        if offset < 0 or size < 28 or offset + size > len(data):
            raise ValueError("invalid_slice")
        magic = data[offset:offset + 4]
        if magic not in NATIVE_MAGICS or magic in (b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"):
            raise ValueError("invalid_macho_header")
        endian = "<" if magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe") else ">"
        is64 = magic in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf")
        _, cpu, subtype, _, count, commands_size, _ = struct.unpack_from(endian + "IiiIIII", data, offset)
        cursor = offset + (32 if is64 else 28)
        limit = cursor + commands_size
        if count > 16384 or limit > offset + size:
            raise ValueError("invalid_load_commands")
        result = {"architecture": {0x100000c: "arm64", 0x1000007: "x86_64", 12: "arm", 7: "i386"}.get(cpu, "unknown"), "cpu_subtype": subtype & 0xffffff, "minimum_os": None, "dependencies": [], "rpaths": []}
        for _ in range(count):
            if cursor + 8 > limit:
                raise ValueError("truncated_command")
            command, length = struct.unpack_from(endian + "II", data, cursor)
            if length < 8 or cursor + length > limit:
                raise ValueError("invalid_command_size")
            if command == 0x32:
                if length < 24 or struct.unpack_from(endian + "I", data, cursor + 8)[0] != 1:
                    raise ValueError("invalid_macos_build_command")
                result["minimum_os"] = packed_version(struct.unpack_from(endian + "I", data, cursor + 12)[0])
            elif command == 0x24:
                if length < 16:
                    raise ValueError("invalid_minimum_command")
                result["minimum_os"] = packed_version(struct.unpack_from(endian + "I", data, cursor + 8)[0])
            elif command in (0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023, 0x8000001c):
                if length < 12:
                    raise ValueError("invalid_path_command")
                start = struct.unpack_from(endian + "I", data, cursor + 8)[0]
                if start < 12 or start >= length:
                    raise ValueError("invalid_path_offset")
                raw = data[cursor + start:cursor + length]
                if b"\0" not in raw:
                    raise ValueError("unterminated_path")
                value = raw.split(b"\0", 1)[0].decode("utf-8", "strict")
                result["rpaths" if command == 0x8000001c else "dependencies"].append(value)
            cursor += length
        if cursor != limit:
            raise ValueError("load_command_size_mismatch")
        return result

    magic = data[:4]
    if magic in (b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca", b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"):
        if len(data) < 8:
            raise ValueError("invalid_fat_header")
        endian = ">" if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf") else "<"
        fat64 = magic in (b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca")
        count = struct.unpack_from(endian + "I", data, 4)[0]
        step = 32 if fat64 else 20
        if not 0 < count <= 32 or 8 + step * count > len(data):
            raise ValueError("invalid_fat_table")
        slices = []
        for index in range(count):
            values = struct.unpack_from(endian + ("iiQQII" if fat64 else "iiIII"), data, 8 + index * step)
            offset, size = values[2:4]
            if offset < 8 + step * count:
                raise ValueError("fat_slice_overlaps_header")
            slices.append(thin(offset, size))
        return slices
    return [thin(0, len(data))]


def run(arguments: list[str], timeout: int = 20) -> tuple[int | None, str]:
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, check=False, env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LC_ALL": "C"})
        return result.returncode, result.stdout + result.stderr
    except (OSError, subprocess.TimeoutExpired):
        return None, ""


def quarantine(path: Path) -> dict:
    code, output = run(["/usr/bin/xattr", "-px", "com.apple.quarantine", str(path)])
    if code == 0:
        try:
            value = bytes.fromhex(output).decode("utf-8").split(";", 1)[0]
            flags = int(value, 16)
            return {"status": "fail" if flags & 4 else "pass", "reason": "hard_quarantine" if flags & 4 else "ordinary_quarantine_present", "flags": format(flags, "04x")}
        except (ValueError, UnicodeError):
            return {"status": "blocked", "reason": "unrecognized_quarantine_attribute"}
    if code is not None and ("No such xattr" in output or "Attribute not found" in output or "No such attribute" in output):
        return {"status": "pass", "reason": "no_direct_attribute_inherited_state_unknown"}
    return {"status": "blocked", "reason": "quarantine_read_unavailable"}


def bundle_digest(app: Path) -> str:
    rows = []
    for directory, directories, files in os.walk(app, followlinks=False):
        for name in sorted(directories + files):
            path = Path(directory) / name
            relative = path.relative_to(app).as_posix()
            mode = stat.S_IMODE(path.lstat().st_mode)
            if path.is_symlink():
                rows.append([relative, "link", mode, os.readlink(path)])
            elif path.is_file():
                rows.append([relative, "file", mode, sha256(path)])
            elif path.is_dir():
                rows.append([relative, "directory", mode])
    payload = json.dumps(sorted(rows), ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def inspect_bundle(app: Path, minimum: str | None = None, expected_version: str | None = None, arch: str = "arm64") -> dict:
    report = {"schema_version": 1, "artifact": {}, "checks": {}, "native_files": [], "runtime": []}
    checks = report["checks"]
    def check(name: str, passed: bool, reason: str):
        checks[name] = {"status": "pass" if passed else "fail", "reason": reason}
    try:
        info_path = app / "Contents/Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        executable_name = info.get("CFBundleExecutable", "")
        if not isinstance(executable_name, str) or not executable_name or Path(executable_name).name != executable_name or "/" in executable_name or "\\" in executable_name:
            raise ValueError("invalid_executable_name")
        executable = app / "Contents/MacOS" / executable_name
        if not executable.is_file() or executable.is_symlink():
            raise ValueError("missing_executable")
        declared = info.get("LSMinimumSystemVersion", "")
        version_tuple(declared)
        requested = minimum or declared
        version_tuple(requested)
        artifact = report["artifact"]
        artifact.update(version=info.get("CFBundleShortVersionString", "unknown"), declared_minimum=declared, expected_architecture=arch, executable_sha256=sha256(executable), bundle_sha256=bundle_digest(app))
        check("bundle_structure", True, "valid_plist_and_executable")
        check("executable_permission", bool(executable.stat().st_mode & 0o111), "executable_mode")
        check("declared_minimum", version_tuple(declared) == version_tuple(requested), "plist_matches_requested_target")
        if expected_version:
            check("version", artifact["version"] == expected_version, "bundle_version_matches_expected")
        native = []
        links_ok = True
        for directory, directories, files in os.walk(app, followlinks=False):
            for name in directories + files:
                path = Path(directory) / name
                if path.is_symlink():
                    target = os.readlink(path)
                    if os.path.isabs(target) or not path.resolve().is_relative_to(app.resolve()):
                        links_ok = False
                    continue
                if not path.is_file():
                    continue
                with path.open("rb") as stream:
                    magic = stream.read(4)
                if magic not in NATIVE_MAGICS:
                    continue
                try:
                    slices = read_native(path)
                except (ValueError, struct.error, UnicodeError):
                    checks["native_parse_" + str(len(native))] = {"status": "fail", "reason": "invalid_native_binary"}
                    continue
                native.append((path, slices))
                report["native_files"].append({"file": path.relative_to(app).as_posix(), "slices": [{"architecture": row["architecture"], "cpu_subtype": row["cpu_subtype"], "minimum_os": row["minimum_os"]} for row in slices]})
        check("bundle_links", links_ok, "relative_links_stay_inside_bundle")
        check("native_architecture", bool(native) and all(any(row["architecture"] == arch and (arch != "arm64" or row["cpu_subtype"] in (0, 1)) for row in slices) for _, slices in native), "every_native_file_has_requested_baseline_slice")
        check("native_minimum", bool(native) and all(row["minimum_os"] is not None and version_tuple(row["minimum_os"]) <= version_tuple(requested) for _, slices in native for row in slices if row["architecture"] == arch), "real_load_commands_do_not_exceed_declared_target")
        main_rpaths = [entry for path, slices in native if path == executable for row in slices for entry in row["rpaths"]]
        unresolved = 0
        def expand(value: str, loader: Path) -> Path | None:
            if value.startswith("@loader_path/"):
                return loader.parent / value[len("@loader_path/"):]
            if value.startswith("@executable_path/"):
                return executable.parent / value[len("@executable_path/"):]
            if value.startswith("/"):
                return Path(value)
            return None
        for path, slices in native:
            for row in slices:
                if row["architecture"] != arch:
                    continue
                for dependency in row["dependencies"]:
                    if dependency.startswith(("/System/Library/", "/usr/lib/")):
                        continue  # macOS shared-cache libraries need not exist as files.
                    candidates = []
                    if dependency.startswith("@rpath/"):
                        for rpath in row["rpaths"] + main_rpaths:
                            base = expand(rpath, path if rpath in row["rpaths"] else executable)
                            if base is not None:
                                candidates.append(base / dependency[len("@rpath/"):])
                    else:
                        candidate = expand(dependency, path)
                        if candidate is not None:
                            candidates.append(candidate)
                    if not any(candidate.resolve().is_relative_to(app.resolve()) and candidate.is_file() for candidate in candidates):
                        unresolved += 1
        checks["runtime_dependencies"] = {"status": "pass" if unresolved == 0 and native else "fail", "reason": "only_system_or_resolvable_bundled_dependencies" if not unresolved else "external_or_unresolved_dependency", "unresolved_count": unresolved}
    except (OSError, ValueError, KeyError, plistlib.InvalidFileException, TypeError):
        checks["bundle_structure"] = {"status": "fail", "reason": "invalid_or_unreadable_bundle"}
    for name in RUNTIME_CHECKS:
        checks[name] = {"status": "not_run", "reason": "requires_exact_bundle_runtime_evidence"}
    return report


def apply_runtime_evidence(report: dict, evidence: dict):
    artifact = report["artifact"]
    if not isinstance(evidence, dict) or set(evidence) != {"schema_version", "method", "artifact", "environment", "checks"} or evidence.get("schema_version") != 1 or evidence.get("method") not in ("manual_gui", "automated_gui"):
        raise ValueError("invalid_runtime_method")
    if not isinstance(evidence.get("artifact"), dict) or set(evidence["artifact"]) != {"executable_sha256", "bundle_sha256"}:
        raise ValueError("invalid_runtime_artifact")
    if any(not isinstance(evidence["artifact"][key], str) or not re.fullmatch(r"[a-f0-9]{64}", evidence["artifact"][key]) for key in ("executable_sha256", "bundle_sha256")):
        raise ValueError("invalid_runtime_digest")
    if evidence.get("artifact", {}).get("executable_sha256") != artifact.get("executable_sha256") or evidence.get("artifact", {}).get("bundle_sha256") != artifact.get("bundle_sha256"):
        raise ValueError("runtime_artifact_mismatch")
    environment = evidence.get("environment", {})
    required = ("hardware_arch", "process_arch", "chip", "macos_version", "macos_build")
    if not isinstance(environment, dict) or set(environment) != set(required) or any(not isinstance(environment.get(key), str) or not environment[key] or len(environment[key]) > 80 or not re.fullmatch(r"[a-zA-Z0-9 .,_-]+", environment[key]) for key in required):
        raise ValueError("invalid_runtime_environment")
    if environment["hardware_arch"] not in ("arm64", "x86_64") or environment["process_arch"] not in ("arm64", "x86_64") or not re.fullmatch(r"(?:Apple M\d+(?: (?:Pro|Max|Ultra))?|Intel[a-zA-Z0-9 ()_. -]*)", environment["chip"]):
        raise ValueError("invalid_runtime_hardware")
    version_tuple(environment["macos_version"])
    rows = evidence.get("checks", {})
    if not isinstance(rows, dict) or set(rows) != set(RUNTIME_CHECKS) or any(not isinstance(row, dict) for row in rows.values()) or not any(row.get("status") == "pass" for row in rows.values()):
        raise ValueError("invalid_runtime_checks")
    for name, row in rows.items():
        if set(row) != {"status", "reason"} or row["status"] not in ("pass", "fail", "blocked", "not_run") or not re.fullmatch(r"[a-z0-9_]{1,80}", row["reason"]):
            raise ValueError("invalid_runtime_check")
    report["runtime"].append({"method": evidence["method"], "human_attestation": evidence["method"] == "manual_gui", "environment": environment, "checks": rows})
    # Keep per-environment records. A passing machine never erases a failed one.
    for name, row in rows.items():
        previous = report["checks"][name]
        if previous["status"] == "fail" or row["status"] == "not_run":
            continue
        report["checks"][name] = dict(row)


def platform_checks(report: dict, app: Path, dmg: Path | None):
    checks = report["checks"]
    if platform.system() != "Darwin":
        for name in ("signature_integrity", "gatekeeper", "app_quarantine", "executable_quarantine", "notarization"):
            checks[name] = {"status": "not_run", "reason": "requires_macos"}
        return
    code, _ = run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)])
    checks["signature_integrity"] = {"status": "blocked" if code is None else "pass" if code == 0 else "fail", "reason": "strict_recursive_codesign_verification"}
    code, output = run(["/usr/bin/codesign", "-d", "--verbose=4", str(app)])
    report["artifact"]["signature_kind"] = "ad_hoc" if "Signature=adhoc" in output else "developer_id" if "Developer ID Application" in output else "unknown"
    code, output = run(["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", str(app)])
    checks["gatekeeper"] = {"status": "pass" if code == 0 else "fail" if "rejected" in output.lower() or "not allowed" in output.lower() else "blocked", "reason": "accepted_on_inspection_host" if code == 0 else "execution_policy_rejected" if "rejected" in output.lower() or "not allowed" in output.lower() else "execution_policy_unavailable"}
    checks["app_quarantine"] = quarantine(app)
    try:
        info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
        name = info["CFBundleExecutable"]
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError("invalid_executable")
        checks["executable_quarantine"] = quarantine(app / "Contents/MacOS" / name)
    except (OSError, KeyError, ValueError, plistlib.InvalidFileException):
        checks["executable_quarantine"] = {"status": "blocked", "reason": "no_valid_executable"}
    checks["notarization"] = {"status": "not_run", "reason": "not_inferred_from_signature_or_gatekeeper"}
    if dmg:
        try:
            report["artifact"]["dmg_sha256"] = sha256(dmg)
            checks["dmg_quarantine"] = quarantine(dmg)
            code, _ = run(["/usr/bin/hdiutil", "verify", str(dmg)], timeout=60)
            checks["dmg_integrity"] = {"status": "blocked" if code is None else "pass" if code == 0 else "fail", "reason": "hdiutil_verify_without_mounting"}
        except OSError:
            checks["dmg_integrity"] = {"status": "blocked", "reason": "dmg_read_unavailable"}
    else:
        checks["dmg_integrity"] = {"status": "not_run", "reason": "no_dmg_supplied"}
    environment = {}
    for key, command in (("chip", ["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"]), ("model", ["/usr/sbin/sysctl", "-n", "hw.model"]), ("macos_version", ["/usr/bin/sw_vers", "-productVersion"]), ("macos_build", ["/usr/bin/sw_vers", "-buildVersion"])):
        code, output = run(command)
        if code == 0 and re.fullmatch(r"[a-zA-Z0-9 .,_-]{1,80}", output.strip()):
            environment[key] = output.strip()
    report["inspection_environment"] = environment


def write_report(report: dict, directory: Path):
    states = [row["status"] for row in report["checks"].values()]
    report["summary"] = "fail" if "fail" in states else "blocked" if "blocked" in states else "not_run" if "not_run" in states else "pass"
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    with (directory / "compatibility.json").open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    rows = ["# macOS compatibility evidence", "", f"Overall: **{report['summary']}**", "", "Static checks and exact-bundle runtime observations are separate. Untested M1/M2/M3/M4 and OS combinations remain unverified. No security settings or input files were modified.", "", "| Check | Status | Evidence |", "| --- | --- | --- |"]
    rows.extend(f"| {name} | {row['status']} | {row['reason']} |" for name, row in report["checks"].items())
    rows += ["", "## Artifact", "", "```json", json.dumps(report["artifact"], indent=2), "```", "", "No username, address, hardware UUID, source photograph, credentials or raw security metadata is collected. Gatekeeper is measured only on the inspection host; ad-hoc signature integrity does not establish Apple trust. The report does not claim another Mac was tested."]
    (directory / "compatibility.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    for file in directory.iterdir():
        file.chmod(0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--dmg", type=Path)
    parser.add_argument("--minimum")
    parser.add_argument("--expected-version")
    parser.add_argument("--arch", default="arm64", choices=("arm64", "x86_64"))
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--runtime-evidence", type=Path, action="append", default=[])
    arguments = parser.parse_args()
    app, directory = arguments.app.resolve(), arguments.report_dir.resolve()
    if not app.is_dir() or arguments.app.is_symlink() or directory.exists() or directory.is_relative_to(app):
        parser.error("Use an existing ordinary app bundle and a NEW report directory outside the app.")
    if arguments.dmg and (arguments.dmg.is_symlink() or not arguments.dmg.is_file() or arguments.dmg.suffix.lower() != ".dmg"):
        parser.error("The DMG must be an existing ordinary .dmg file.")
    report = inspect_bundle(app, arguments.minimum, arguments.expected_version, arguments.arch)
    platform_checks(report, app, arguments.dmg)
    for evidence in arguments.runtime_evidence:
        try:
            if evidence.stat().st_size > 1024 * 1024:
                raise ValueError("oversized_runtime_evidence")
            apply_runtime_evidence(report, json.loads(evidence.read_text(encoding="utf-8")))
        except (OSError, ValueError, KeyError, TypeError):
            report["checks"]["external_runtime_evidence"] = {"status": "fail", "reason": "invalid_or_different_artifact_evidence"}
    write_report(report, directory)
    print(json.dumps({"summary": report["summary"], "checks": {name: row["status"] for name, row in report["checks"].items()}}, ensure_ascii=False))
    return 1 if report["summary"] == "fail" else 2 if report["summary"] == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
