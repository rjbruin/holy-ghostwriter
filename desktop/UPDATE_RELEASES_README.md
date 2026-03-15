# Updates distribueren via GitHub Releases

Deze app controleert updates via de GitHub Releases API van `rjbruin/holy-ghostwriter`.
Builds worden automatisch aangemaakt via GitHub Actions zodra je een versie-tag pusht.

## Geautomatiseerde release (aanbevolen)

### Stap 1 — Versiebump

Voer het bijgeleverde script uit vanuit de projectroot:

```bash
./scripts/bump-version.sh 1.2.3
```

Het script:
- past `APP_VERSION` aan in `app.py`
- past `version` aan in `desktop/package.json`
- maakt een git-commit en een annotated tag (`v1.2.3`)

### Stap 2 — Tag pushen

```bash
git push origin main --follow-tags
```

Dit triggert automatisch de GitHub Actions workflow (`.github/workflows/release.yml`), die:
1. De Flask-server bundelt met PyInstaller op zowel macOS als Windows.
2. De Electron-installers bouwt (`.dmg` voor macOS, `.exe` voor Windows).
3. Een GitHub Release aanmaakt met automatische release notes en beide installers als bijlage.

### Stap 3 — Release controleren

Ga naar **GitHub → Releases** en controleer de release. Voeg eventueel handmatige release notes toe.

---

## Handmatige build (lokaal testen)

Als je lokaal wilt bouwen zonder de CI te gebruiken:

```bash
# macOS
cd desktop
npm run build-mac

# Windows
cd desktop
npm run build-win
```

De installers staan daarna in `desktop/dist/`.

> **Let op:** PyInstaller en de Python-dependencies moeten aanwezig zijn.
> Zorg dat je in je venv zit en installeer eerst:
> ```bash
> pip install -r requirements.txt pyinstaller
> ```

---

## Wat de app doet

- De homepage checkt automatisch op de nieuwste GitHub Release.
- Als er een nieuwere versie is:
  - verschijnt er een update-icoon naast instellingen;
  - wordt (eenmalig) een update-modal getoond met versie + changelog;
  - kan de gebruiker die versie negeren.
- In de instellingen verschijnt bovenin de prompt-kolom een update-notitie met link naar de release.

## Tips

- Houd tags semver-achtig (`vMAJOR.MINOR.PATCH`) voor consistente vergelijking.
- De GitHub Actions workflow gebruikt `generate_release_notes: true`, wat automatisch een changelog genereert op basis van pull request-titels en commits.
- Zet duidelijke PR-titels en commit-messages zodat de automatische changelog informatief is.
