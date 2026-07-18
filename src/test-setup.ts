import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate tests from the real ~/.config/clickup-axi runtime state —
// especially the readonly marker (~/.config/clickup-axi/readonly) that blocks
// --execute on the captain's box. Tests that exercise --execute need the gate
// OFF; pointing the config dir at an empty temp dir achieves that without
// weakening the real gate (the marker stays on disk for the real runtime, and
// the temp dir has no marker/config.json). Tests that want the gate ON set
// CLICKUP_AXI_READONLY=1 explicitly, which takes precedence over the marker.
const tempConfigDir = mkdtempSync(join(tmpdir(), "clickup-axi-test-"));
process.env["CLICKUP_AXI_CONFIG_DIR"] = tempConfigDir;
