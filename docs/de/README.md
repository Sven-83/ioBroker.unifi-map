# ioBroker.unifi-map – Deutsche Anleitung

[English](../../README.md)

ioBroker-Adapter für UniFi-Netzwerke: Laufen alle Geräte, welcher Uplink ist langsam, welches Gerät hat neu gestartet.
Mit Topologie-Karte als Admin-Tab. Firmware-Updates auf Knopfdruck folgen in einer späteren Version.

> **In Arbeit.** Version 0.1.0 liest Status und Topologie und zeigt die Karte (Phase 2 bis 4 von 6). An die Konsole wird nichts geschrieben.

## Funktionen
- Status jedes UniFi-Geräts (Konsole, Switches, Access Points): online, Firmware, Laufzeit, Clients
- Uplink je Gerät: Kabel oder Mesh, Link-Tempo, Signal bei Mesh
- Gelb, wenn ein Kabel-Uplink langsamer als gewohnt wird (gewohnt = schnellstes bisher gesehenes Tempo, gespeichert in `info.linkSpeeds`); Links, die schon immer langsam liefen, bleiben grün. Der Knopf `acceptLinkSpeeds` übernimmt die aktuellen Tempos als gewohnt (z. B. nach einem Kabeltausch)
- Neustart-Erkennung, auch für Neustarts, während der Adapter aus war; Neustarts der letzten 7 Tage
- Zusammenfassung für eine Kachel: `ok`, `degraded`, `offline`, `stale` (Daten zu alt – nie Grün aus alten Werten)
- Topologie: wer hängt an wem, Kabel oder Mesh, als JSON für die Karte
- Admin-Tab **Netzwerk**: Karte des Netzes von der Konsole abwärts, live. Kabel grau, Mesh blau gestrichelt, ein Abschnitt ohne UniFi (einfacher Switch, Powerline) orange gepunktet; Port und Tempo an jeder Verbindung. Ausgefallene Geräte rot, Geräte dahinter grau gestrichelt, Updates markiert. Antippen zeigt Details (Modell, Verbindung, Laufzeit, Firmware, Clients, IP)
- Ein Ausfall wird nur für die Ursache gemeldet: Geräte, die hinter einem ausgefallenen Gerät abgeschnitten sind,
  gelten als Folge. Geräte, die einen anderen Weg finden (ein Mesh-AP wechselt zu einem anderen Elterngerät), zählen als
  online und melden `uplinkChanged`
- Letztes Ereignis (offline, online, Neustart, Uplink gewechselt, langsam, wieder gut) als JSON für Skripte

## Voraussetzungen
- Eine UniFi-Konsole mit UniFi OS und UniFi Network 9.3 oder neuer (getestet mit UDR und Network 10.6.109)
- Ein API-Schlüssel eines lokalen Benutzers mit **Nur-Lese-Rolle**
- js-controller ab 6.0.11, admin ab 7.6.20, Node.js ab 22

## Installation
Der Adapter steht noch nicht in den ioBroker-Repositories. Installation von GitHub:
```bash
iob url https://github.com/Sven-83/ioBroker.unifi-map
```

## Einstellungen
| Einstellung | Bedeutung |
|---|---|
| Adresse der Konsole / Port | IP-Adresse oder Hostname der Konsole, Port 443 |
| API-Schlüssel | In UniFi unter Einstellungen > Control Plane > Integrationen für einen lokalen Benutzer mit Nur-Lese-Rolle anlegen; wird verschlüsselt gespeichert |
| Zertifikat abrufen | Liest das selbstsignierte Zertifikat der Konsole und zeigt den SHA-256-Fingerabdruck. Mit dem Fingerabdruck vergleichen, den der Browser für die Konsole zeigt, dann speichern. Danach wird nur dieses Zertifikat akzeptiert; der Schlüssel geht nie über eine andere Verbindung |
| Geräteliste alle | Sekunden, 30 bis 3600, Standard 60 |
| Details, Clients und Uplinks alle | Sekunden, 60 bis 3600, Standard 300; zusätzlich sofort, wenn ein Gerät seinen Zustand ändert |
| Name eines Abschnitts ohne UniFi | z. B. `Powerline` oder der Name eines einfachen Switches; die Karte zeigt ihn statt „Nicht UniFi“. Das Kabel in den Abschnitt ist ein normales Kabel, der Weg hindurch orange gepunktet |

## Datenpunkte
| Datenpunkt | Bedeutung |
|---|---|
| `info.connection` | Konsole erreichbar |
| `info.lastUpdate` / `info.dataStale` | Letzte erfolgreiche Abfrage / Daten älter als 3 Intervalle |
| `info.networkVersion` | Version der UniFi-Network-Anwendung |
| `summary.total` / `online` / `offline` / `degraded` / `updates` | Anzahlen |
| `summary.state` | `ok`, `degraded` (langsamer Kabel-Uplink), `offline` (ein Gerät ausgefallen), `stale` (Daten zu alt) |
| `summary.json` | Detailliste für Widgets, Probleme zuerst |
| `devices.<id>.name` / `model` / `role` / `state` / `online` | Gerät; `role` ist `gateway`, `switch` oder `accessPoint` |
| `devices.<id>.ip` / `firmware` / `updatable` / `uptime` / `clients` | Details |
| `devices.<id>.lastRestart` / `restartCount7d` | Zeit des letzten Starts, Neustarts der letzten 7 Tage |
| `devices.<id>.uplinkId` / `uplinkType` / `linkSpeed` / `linkMaxSpeed` / `signal` | Uplink: übergeordnetes Gerät, `wired` oder `wireless`, Tempo (Mesh: Senderate), Signal bei Mesh |
| `devices.<id>.degraded` / `degradedReason` | Kabel-Uplink unter seinem Maximum |
| `devices.<id>.consequence` / `causeId` | Nur deshalb nicht erreichbar, weil das Gerät `causeId` davor ausgefallen ist |
| `topology.json` | `rootId`, `nodes` (Zustand `ok`, `degraded`, `offline`, `consequence`, `busy`; Elterngerät; Tiefe) und `edges` (Kabel/Mesh, Tempo, Signal) |
| `events.last` | Letztes Ereignis als JSON: `time`, `event`, `id`, `name`, `model`; `offline` zusätzlich `affected` (dahinter abgeschnittene Geräte), `uplinkChanged` mit `from` und `to` |
| `refresh` | Taster: alles sofort lesen (höchstens alle 10 s) |

`<id>` ist die ID der UniFi-API, nicht Name oder MAC-Adresse. Updates und Starts (`UPDATING`, `GETTING_READY`)
zählen nicht als Ausfall.

## Sicherheit
- Nur lesend: Der Adapter schickt ausschließlich GET-Anfragen.
- Der API-Schlüssel wird verschlüsselt gespeichert und nur an das bestätigte Zertifikat geschickt. Einen Schlüssel
  eines Nur-Lese-Benutzers verwenden und mit Ablaufdatum versehen.
- Gerätenamen und MAC-Adressen kommen nur auf Log-Stufe debug ins Log.
- Schwachstellen bitte wie in [SECURITY.md](../../SECURITY.md) beschrieben melden.

## Bekannte Grenzen
- Kabel/Mesh und das Tempo des Uplinks stehen nicht in der offiziellen Integration API. Sie kommen aus der
  klassischen Geräteliste (`/proxy/network/api/s/<site>/stat/device`), die inoffiziell ist und sich mit Updates
  ändern kann. Fällt sie aus, läuft alles andere weiter, nur die Uplink-Felder bleiben leer.
- Mesh-Links haben kein Höchsttempo und werden deshalb nie gelb.
- Uplinks werden mit den Details gelesen (Standard alle 5 Minuten, sofort bei einer Zustandsänderung): Ein Mesh-AP,
  der ohne Zustandsänderung umzieht, fällt mit den nächsten Details auf.
- Ausgefallene Geräte melden keinen Uplink; der letzte bekannte wird behalten (auch über Adapter-Neustarts), um die
  Ursache zu finden.
- Geräte hinter einem Switch, der kein UniFi-Gerät ist, zeigen oft gegenseitig aufeinander als Elterngerät (einfache
  Switches reichen die Erkennungspakete durch). Ein solcher Kreis erscheint unter einem Platzhalter
  `unknown-switch-<n>` (`virtual: true`, Rolle `unknownSwitch`) unter der Konsole; wo genau dieser Switch hängt, ist
  unbekannt.
- Eine Site je Konsole (die erste).
