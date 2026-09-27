# Upgrading

## From 1.1 or earlier

The credential type was renamed (from `typeSafeApi` to `taifoonTypeSafeApi`) so it cannot collide with other
TypeSafe packages or a future built-in node. After updating, create the **TypeSafe API** credential again and
select it in your TypeSafe nodes. Nothing else changed. If you pre-fill credentials from a file, use the new
name as the key ([Supplying keys securely](SECURE_KEYS.md)).
