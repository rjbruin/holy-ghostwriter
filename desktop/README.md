# Desktop packaging (Electron)

## Voorwaarden
- Node.js 20+
- Python omgeving met dependencies uit `../requirements.txt`

## Starten
```bash
cd desktop
npm install
npm run start
```

## Build installers
```bash
cd desktop
npm run build
```

Dit bouwt een macOS (`dmg`) en Windows (`nsis`) package wanneer uitgevoerd op het betreffende platform.

### Windows installer (NSIS)

De Windows-build gebruikt `electron-builder` met het target `nsis`. Je hoeft NSIS normaal niet handmatig te installeren: `electron-builder` regelt dit zelf tijdens de build.

Praktische workflow op Windows:

```powershell
cd desktop
npm install
npm run build
```

Na een succesvolle build staan de Windows-artifacts in `desktop/dist/`. Verwacht in elk geval een installerbestand met een naam in de vorm `Holy Ghostwriter Setup <versie>.exe`.

Belangrijk om te weten:
- Bouw de Windows-installer bij voorkeur op Windows zelf. Cross-compilen van Windows-installers vanaf macOS is niet de standaardroute en geeft sneller problemen.
- De NSIS-installer installeert de app als normale Windows-desktoptoepassing, inclusief uninstall-ondersteuning.
- Als Windows SmartScreen waarschuwt bij het openen van de installer, komt dat meestal doordat de build niet is code-signed. Voor intern testen is dat normaal; voor distributie aan eindgebruikers is code signing aan te raden.
- Als je alleen een Windows-build wilt maken, kun je ook direct `npx electron-builder --win nsis` uitvoeren vanuit `desktop/`.

Controleer na het bouwen altijd even of de installer:
- de app start;
- de ingebouwde Flask-server meekomt;
- en de app weer correct verwijdert via Windows Apps of Configuratiescherm.

## Contextmenu
De desktop-app biedt in het contextmenu:
- `Open`
- `Afsluiten`

`Afsluiten` stopt de Electron-app én de onderliggende Flask server.

## Updates distribueren

Zie `desktop/UPDATE_RELEASES_README.md` voor het release- en updateproces via GitHub Releases.
