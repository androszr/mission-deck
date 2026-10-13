# crypto-v1 fixture

Plaintext/mirror pair written by an independent implementation of the legacy
v1 writer (`encryptTree(plain, mirror, key, hkdfInfo, { encryptPaths: false })`),
so this fixture proves byte-for-byte compatibility between that writer and
`encryptBufferV1` in `scripts/crypto-sync.js` (this repo).

## Test key

`key.txt` holds a TEST key only - `generateKey()` output, base64, 32 bytes
decoded. It never touches a real mirror and must never be reused for one.

## hkdfInfo

`Buffer.from('cockpit-data-mini-v1')` - an example per-source context string,
the kind a `DATA_REPO_DEFS` row in `server.js` carries as `hkdfInfo`.

## Layout

```
plain/public/allowed-users.json                    text, top level under public/
plain/mini-analytics/wdrozenia/meta.json           text, subdirectory two levels deep
plain/public/avatars/logo.png                      binary (2x2 PNG), subdirectory two levels deep

mirror/public/allowed-users.json.enc
mirror/mini-analytics/wdrozenia/meta.json.enc
mirror/public/avatars/logo.png.enc
```

Each `mirror/<relPath>.enc` is `encryptTree`'s v1 layout: bare base64 (no
`v2:` prefix), salt = `sha256(relPath)[0:16]`, IV = `sha256(plaintext)[0:12]`,
AES-256-GCM. The file keeps its real path (`encryptPaths: false`), so the
name in the mirror is `<relPath>.enc`, never an HMAC.

## Regenerating

The mirror is frozen on purpose: it is the reference the v1 reader and writer
are checked against. If it ever has to change, write it with
`encryptBufferV1` from `scripts/crypto-sync.js` (key from `key.txt`, hkdfInfo
above) and confirm the old bytes still decrypt before replacing them.
