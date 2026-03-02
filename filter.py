import re
from pathlib import Path

# Categories you want to keep (must appear like: T8_<CATEGORY>_...)
CATEGORIES = ["POTION", "MEAL", "OFF", "CAPEITEM", "BAG", "MOUNT", "HEAD", "ARMOR", "SHOES", "MAIN", "2H"]

# Anything containing these gets removed
BLOCKED = ["UNIQUE", "SILVERBAR", "ARTEFACT"]

input_file = Path("./public/items.txt")
output_file = Path("cleaned_items.txt")

keep_re = re.compile(rf"\bT\d+_({'|'.join(map(re.escape, CATEGORIES))})_", re.IGNORECASE)
blocked_re = re.compile(r"|".join(map(re.escape, BLOCKED)), re.IGNORECASE)

out_lines = []
for line in input_file.read_text(encoding="utf-8", errors="replace").splitlines(True):
    if blocked_re.search(line):
        continue
    if keep_re.search(line):
        out_lines.append(line)

output_file.write_text("".join(out_lines), encoding="utf-8")
print(f"Wrote {len(out_lines)} lines -> {output_file}")
