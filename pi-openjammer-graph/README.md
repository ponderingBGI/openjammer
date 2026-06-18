# pi-openjammer-graph

Bundled Pi package loaded by the OpenJammer desktop app. It registers the OpenJammer canvas verbs (`get_graph`, `emit_plan`, `add_node`, `add_connection`, diagnostics/settings tools, etc.) as Pi tools.

Each tool execution round-trips through the OpenJammer host bridge (`OJ_BRIDGE_ADDR` + `OJ_BRIDGE_TOKEN`). The app applies the same reversible graph-store verbs a user drives by hand, and read tools return the live graph/settings/log data so Pi reasons from the actual canvas.

This is a Pi resource, not webview source; it is bundled as a Tauri resource and loaded from the installed app's resource directory.
