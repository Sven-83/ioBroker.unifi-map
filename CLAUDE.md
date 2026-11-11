# CLAUDE.md – ioBroker.unifi-map

## Projekt
ioBroker-Adapter für UniFi-Netzwerke: Gerätestatus, Topologie-Karte (Admin-Tab), Firmware-Updates auf Knopfdruck.
Spezifikation: Claude-Specs `unifi-netzwerk.md` (Drive), lokaler Arbeitsordner `../` (Probe-Skript in `../probe`, Rohdaten nie ins Repo).

- **Adaptername:** `unifi-map`
- **Installation:** `iob url Sven-83/ioBroker.unifi-map` aus `main`. Keine Releases, keine Tags, kein npm.
- **Autor-Mail** überall nur `276080681+Sven-83@users.noreply.github.com` (lokale git-Config gesetzt, pre-commit-Hook prüft).
- **Sprache:** TypeScript strict, Node ≥ 22 (CI 22/24/26), js-controller ≥ 6.0.11, admin ≥ 7.6.20.

## Datenschutz
- Gerätenamen im echten Netz sind Raumnamen: **nie** in Repo, Tests, Fixtures, Screenshots, Artifacts. Tests nutzen
  nur erfundene Namen, IDs und Adressen (`192.0.2.x`, `02:00:00:…`).
- Den API-Schlüssel gibt Sven nur selbst ein (Admin oder eigenes Terminal), nie über Claude.
- Log: keine Schlüssel; Gerätenamen und MAC nur auf debug.

## API
- Offiziell: Integration API `/proxy/network/integration/v1` mit `X-API-KEY`.
- **Inoffiziell** (als Konstante gekennzeichnet, Ausfall darf die Grundfunktion nicht stoppen, B.11.18):
  klassisch `/proxy/network/api/s/<site>/stat/device` (Kabel/Mesh, Tempo), später `cmd/devmgr` (Firmware).
- TLS: Zertifikat der Konsole wird in den Einstellungen abgerufen und bestätigt, danach nur dieses akzeptiert
  (`ca` + Fingerabdruck in `checkServerIdentity`). Prüfung nie abschalten.

## Regeln (Audit-Template v1.7)
- Genau eine Timer-Kette über `this.setTimeout`, Jitter, Backoff 30 s → 30 min, 429 mit `Retry-After`.
- `ack: true` nur durch den Adapter, nie `ack: false`. Keine fremden Objekte anlegen (B.10.23).
- Störende Aktionen (Firmware, Neustart) nur auf Befehl, mit Bestätigung, ein Gerät nach dem anderen, zurücklesen (B.11.19).
- Push nur nach OK von Sven und nur bei grünem Lint, Build und allen Tests (pre-push-Hook).
