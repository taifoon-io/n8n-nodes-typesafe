# Upgrading

## From 2.x to 3.0.0

n8n's verified community nodes may not be flow-control nodes and may not have run-time dependencies, so 3.0.0:

- **Has one output.** Pass / Fail / Review are no longer three outputs. Every item leaves by the one output and
  carries `outcome: "pass" | "fail" | "review"` (it was `branch`). To keep the old wiring, put a **Switch** node after
  TypeSafe with three rules on `{{ $json.outcome }}` (equals `pass`, `fail`, `review`) and move each old connection
  to the matching Switch output. On n8n, open the workflow after updating: the connections from outputs 2 and 3 are
  gone and must be re-attached to the Switch. `node examples/outcome-switch.mjs <file>` does this to an exported
  workflow file.
- **Renames the field `branch` to `outcome`**, and the parameter "Routing (JSON)" is shown as "Thresholds (JSON)" (its
  internal name `routing` and its JSON are unchanged, so saved workflows keep their thresholds).
- **Has no dependencies.** 2.0.5 installed `@taifoon/jev` and `@taifoon/jev-wilson` with it; the node never imported
  them (its grader code is vendored). Install them yourself if another node of yours uses them.
- **Drops the approval-gate and MCP examples.** They described a hosted relay, which is a second service.
- With **Continue On Fail**, an error item now leaves by the one output with `outcome: "review"`.

## From 1.1 or earlier

The credential type was renamed (from `typeSafeApi` to `taifoonTypeSafeApi`) so it cannot collide with other
TypeSafe packages or a future built-in node. After updating, create the **TypeSafe API** credential again and
select it in your TypeSafe nodes. Nothing else changed. If you pre-fill credentials from a file, use the new
name as the key ([Supplying keys securely](SECURE_KEYS.md)).
