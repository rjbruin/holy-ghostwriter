# Bijbel

## Nieuwe Bijbelvertaling '21

Leesbaar voor mensen op https://www.debijbel.nl/bijbel/NBV

## Statenvertaling

Voor ontwikkelaars hebben wij een API geschreven waarmee ze de inhoud van de Bijbel kunnen ophalen. Het output formaat is XML.
De URL: https://online-bijbel.nl/api.php

Ophalen bijbelteksten
Om bijbelteksten op te halen dient u het nummer van het bijbelboek te weten. Dit nummer kunt u ophalen middels het voorbeeld hieronder. Met de volgende parameters haalt u teksten op:
b = bijbelboeknummer
h = hoofdstuknummer
v = versnummer(s)

U spreekt de URL als volgt aan: https://online-bijbel.nl/api.php?b=1&h=1&v=1

Bij de parameters voor de verzen kunt u er meerdere opgeven. Dat kan zo voor vers 1 en 3: 1,3. Voor een heel gedeelte, bijv. vers 5 tot en met 9, kiest u: 5-9.

Ophalen bijbelboeknummer
Bijbelboeknummers haalt u op de volgende manier op:

https://online-bijbel.nl/api.php?p=boekenlijst
