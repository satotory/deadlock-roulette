"""Verify that the portable EXE embeds the application's ICO image payloads."""
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
exe_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "Deadlock Roulette.exe"
exe = exe_path.read_bytes()
icon = (ROOT / "assets" / "app.ico").read_bytes()


def u16(data, offset):
    return struct.unpack_from("<H", data, offset)[0]


def u32(data, offset):
    return struct.unpack_from("<I", data, offset)[0]


pe = u32(exe, 0x3C)
assert exe[pe:pe + 4] == b"PE\0\0", "Not a Windows PE executable"
section_count = u16(exe, pe + 6)
optional_size = u16(exe, pe + 20)
optional = pe + 24
directory_base = optional + (112 if u16(exe, optional) == 0x20B else 96)
resource_rva = u32(exe, directory_base + 16)
sections = optional + optional_size


def rva_offset(rva):
    for index in range(section_count):
        section = sections + index * 40
        virtual_size = u32(exe, section + 8)
        virtual_address = u32(exe, section + 12)
        raw_size = u32(exe, section + 16)
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return u32(exe, section + 20) + rva - virtual_address
    raise ValueError(f"Unmapped resource RVA: {rva}")


resource_base = rva_offset(resource_rva)


def resources(directory=0, keys=()):
    offset = resource_base + directory
    count = u16(exe, offset + 12) + u16(exe, offset + 14)
    for index in range(count):
        entry = offset + 16 + index * 8
        key = u32(exe, entry)
        target = u32(exe, entry + 4)
        if target & 0x80000000:
            yield from resources(target & 0x7FFFFFFF, keys + (key,))
        else:
            leaf = resource_base + target
            payload = rva_offset(u32(exe, leaf))
            length = u32(exe, leaf + 4)
            yield keys + (key,), exe[payload:payload + length]


embedded_icons = [payload for keys, payload in resources() if keys[0] == 3]
icon_count = u16(icon, 4)
matched = 0
for index in range(icon_count):
    entry = 6 + index * 16
    size = u32(icon, entry + 8)
    offset = u32(icon, entry + 12)
    payload = icon[offset:offset + size]
    matched += payload in embedded_icons
assert matched == icon_count, f"Expected {icon_count} custom icon sizes, found {matched}"
print(f"Verified {matched} custom icon sizes embedded in {exe_path}")
