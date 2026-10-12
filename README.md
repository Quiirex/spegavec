<p align="center">
  <img src="assets/spegavec_logo.png" alt="Špegavec" width="280">
</p>

> **EN:** Špegavec (“the snoop”) is a self-hosted Discord bot that watches real-estate searches
> on the Slovenian portal [nepremicnine.net](https://www.nepremicnine.net) and notifies you about
> new listings and price changes. The docs below are in Slovenian, like its audience.
> Not affiliated with nepremicnine.net; use it moderately and within the site's terms.

Samostojen špegavec nepremičninskih oglasov. Periodično pregleduje iskanja na
[nepremicnine.net](https://www.nepremicnine.net), si zapomni, kaj je že videl, in te ob vsakem
novem oglasu (ali spremembi cene) obvesti preko Discorda.

Hkrati gradi **lastno zgodovino cen**: za vsak oglas v iskanju si zapomni vsako spremembo cene,
kdaj se je pojavil in kdaj je izginil. Stran sama tega ne pokaže, ti pa lahko vidiš, kako dolgo
je oglas že na trgu, kolikokrat so ga pocenili in kam se gibljejo cene v tvojem iskanju.

Iskanja dodajaš in upravljaš s slash ukazi, novi oglasi pa pridejo kot lepi embedi v kanal,
kjer si iskanje ustvaril.

Obvestilo je embed s fotografijo, izsekom opisa in kontaktom, približno takole:

> 🟢 **Dober posel · center-2s**
> **[ČRNUČE, LJ. - BEŽIGRAD](https://www.nepremicnine.net)**
> Cena **224.000 €** · €/m² **6.871 €** · Velikost **32,6 m²** · Sobe **1-sobno** · Leto **2008**
> 💸 **16 % pod** mediano iskanja (8.200 €/m²)

Ob spremembi cene pride manjši embed: `240.000 € → 224.000 € (−6,7 %)`.

## Obvestila

- **Nov oglas**: fotografija, cena, €/m², velikost, sobe, leto, nadstropje, agencija z naslovom,
  kontaktna oseba s telefonom in prvih ~500 znakov opisa. Kontakt in opis bot pobere s strani
  oglasa (največ 15 novih oglasov na obhod, ostali pridejo s podatki iz iskalne strani).
- **🟢 Dober posel**: nov oglas, ki je vsaj **15 % pod mediano €/m²** iskanja. Mediana se računa
  šele, ko ima iskanje vsaj 5 oglasov z znano €/m².
- **Cena znižana / zvišana**: stara in nova cena ter sprememba v %.
- **Spet na voljo**: oglas, ki je bil umaknjen, se je vrnil (s staro ceno, če se je vmes
  spremenila).
- Umaknjeni/prodani oglasi se v kanal ne javljajo, ostanejo pa v bazi (`/zgodovina`,
  `/povzetek`, `/izvoz`).
- Fotografije bot pobere sam in jih priloži sporočilu. Če nalaganje ne uspe, gre obvestilo
  naprej brez slike.
- Blokade in napake ne pišejo v kanal: vidiš jih v `/status` in v logih.

## Zgodovina cen

Vsak obhod gre čez **vse strani** iskanja, ne le čez najnovejše oglase, zato špegavec ujame
spremembo cene na kateremkoli oglasu, tudi takem, ki je na trgu že mesece. Za vsak oglas si
zapomni:

- ceno ob prvem pojavu in vsako poznejšo spremembo, z datumom;
- kdaj se je oglas prvič pojavil in kdaj je izginil (umaknjen/prodan);
- če se vrne, nadaljuje z isto zgodovino.

Zgodovina se začne z dnem, ko dodaš iskanje (za nazaj je stran ne hrani), in ostane tudi za
umaknjene oglase. Do nje prideš na tri načine:

**`/zgodovina ime: oglas:`** pokaže časovnico enega oglasa:

> **ČRNUČE, LJ. - BEŽIGRAD**
> Status: aktiven · 6.871 €/m²
>
> **Zgodovina cene:**
> • 2026-06-02: 240.000 €
> • 2026-07-14: 229.000 € (−11.000 €)
> • 2026-08-03: 224.000 € (−5.000 €)

**`/povzetek [obdobje:]`** zgodovino strne čez celo iskanje: koliko oglasov je bilo v zadnjem
tednu, mesecu ali letu novih in umaknjenih, koliko cen je šlo dol in gor, povprečna sprememba in
ali cene padajo, stojijo ali rastejo.

**`/izvoz ime: kaj:cene`** da celotno zgodovino cen kot CSV (`listing_id`, `title`, `price`,
`observed_at`), primerno za lastno analizo v Excelu ali Pythonu. `kaj:oglasi` doda še datume
prvega pojava in umika vsakega oglasa.

## Kako deluje

- Strani pobira z [`impit`](https://github.com/apify/impit), HTTP odjemalcem, ki se obnaša kot
  običajen brskalnik, brez brskalnika v ozadju.
- Obhod ob vsaki polni uri. Vsako iskanje gre čez **vse strani**
  filtra, da ujame spremembe cen na vsakem oglasu, ne le na najnovejših. Ob blokadi se
  eksponentno umakne.
- Stanje v SQLite (`node:sqlite`, brez native odvisnosti): iskanja, videni oglasi, zgodovina cen.
- Vsak oglas dobi **€/m²**; dovolj pod mediano iskanja ga označi kot **🟢 dober posel**. Oglas,
  ki izgine za dva obhoda, se označi za **umaknjen/prodan**; če se pozneje vrne, dobiš
  obvestilo **spet na voljo** (s staro ceno, če se je spremenila).

## Namestitev

**Zahteve:** Docker — ali pa Node **≥ 24** (`node:sqlite` je vgrajen šele tam) in pnpm
(`corepack enable`).

Na hitro:

1. Ustvari Discord aplikacijo in kopiraj žeton (natančni koraki spodaj).
2. `cp .env.example .env` in vpiši `DISCORD_TOKEN` + `DISCORD_GUILD_ID`.
3. `docker compose up -d --build` (ali LXC + systemd, spodaj).
4. V kanalu, kamor naj padajo obvestila: `/iskanje dodaj` ali `/iskanje sestavi`.

### Discord bot

1. <https://discord.com/developers/applications> → **New Application**. Bot user se ustvari
   samodejno.
2. **Bot** → **Reset Token** → to je `DISCORD_TOKEN`. Privilegiranih intentov ne potrebuješ.
3. **Installation**: pusti samo **Guild Install**, **Install Link** → **Discord Provided Link**,
   scope-a `bot` + `applications.commands`, pravici **Send Messages** + **Embed Links**. Odpri
   link in povabi bota na strežnik.
4. Vklopi Developer Mode (**User Settings → Advanced → Developer Mode**), nato desni klik na
   strežnik → **Copy Server ID** → to je `DISCORD_GUILD_ID`.

### Docker

```sh
cp .env.example .env   # DISCORD_TOKEN, DISCORD_GUILD_ID
docker compose up -d --build
docker compose logs -f
```

Baza se hrani v `./data/` na hostu.

### LXC + systemd (Proxmox)

Brez Dockerja, teče direktno v kontejnerju (LXC je že container, dvojni nima smisla).

```sh
# Node 24 + git v LXC
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git
corepack enable

# koda + konfiguracija
git clone https://github.com/Quiirex/spegavec.git /opt/spegavec && cd /opt/spegavec
cp .env.example .env && nano .env   # DISCORD_TOKEN, DISCORD_GUILD_ID
pnpm install && pnpm build
```

systemd unit `/etc/systemd/system/spegavec.service`:

```ini
[Unit]
Description=Spegavec
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/spegavec
EnvironmentFile=/opt/spegavec/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```sh
systemctl enable --now spegavec
journalctl -u spegavec -f   # logi v živo
```

**Posodobitev** po spremembi kode: `git pull && pnpm install && pnpm build && systemctl restart spegavec`.

### Nastavitve (`.env`)

| Spremenljivka | Privzeto | Pomen |
| --- | --- | --- |
| `DISCORD_TOKEN` | (obvezno) | Žeton Discord bota. |
| `DISCORD_GUILD_ID` | prazno | ID strežnika; z njim se ukazi registrirajo takoj, brez njega globalno (do ~1h). |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ali `error`. `debug` izpiše tudi vsako pobrano stran in ponovne poskuse ob blokadi. |
| `DB_PATH` | `./data/spegavec.db` | Pot do SQLite baze (v Dockerju `/app/data/spegavec.db`). |

## Discord ukazi

| Ukaz | Kaj naredi |
| --- | --- |
| `/iskanje dodaj ime: url:` | Spremljaj URL iskanja, prilepljen z nepremicnine.net (podpira vse filtre strani, `https://` ni obvezen). Bot URL takoj preizkusi in pove, koliko oglasov trenutno ustreza. |
| `/iskanje sestavi ime: posel: regija: tip: [sobnost:] [cena_min/max:] [velikost_min/max:] [letnik_min/max:]` | Sestaviš iskanje iz filtrov, ne da bi zapustil Discord. Regija se samodejno dopolnjuje, vpišeš lahko tudi slug pod-regije, kot ga uporablja stran. Sobnost velja samo za stanovanja, cena pri oddaji je mesečna. |
| `/iskanje seznam` | Pokaže iskanja s stanjem (▶️/⏸), številom sledenih oglasov, kanalom in URL-jem. |
| `/iskanje ustavi\|nadaljuj ime:` | Začasno ustavi ali spet zažene iskanje; podatki ostanejo. |
| `/iskanje odstrani ime:` | Odstrani iskanje **skupaj z vsemi oglasi in zgodovino cen**. |
| `/preveri [ime:]` | Naredi obhod takoj, brez čakanja na cikel (privzeto vsa aktivna iskanja), in pošlje obvestila. |
| `/status` | Zdravje špegavca (🟢/🔴) ter čas in izid zadnjega obhoda po iskanjih. |
| `/zgodovina ime: oglas:` | Časovnica cene oglasa s spremembami, stanje (aktiven ali umaknjen) in €/m². Oglas je ID (npr. `7355533`) ali poln URL. |
| `/povzetek [obdobje:] [ime:]` | Povzetek za zadnji `teden` (privzeto), `mesec` ali `leto`: novi, umaknjeni, znižanja/zvišanja s povprečno spremembo in smer cen (📉/➡️/📈). Privzeto za vsa iskanja. |
| `/posli ime: [stevilo:]` | Najcenejši aktivni oglasi po €/m² (privzeto 5, največ 10) in koliko so pod mediano iskanja. |
| `/izvoz ime: [kaj:]` | CSV priponka z vsemi oglasi (`oglasi`, privzeto, tudi umaknjeni) ali z zgodovino cen (`cene`). Datoteka se pravilno odpre v Excelu. |

Imena iskanj imajo 1–32 znakov (črke, številke, `_`, `-`) in se v ukazih samodejno dopolnjujejo.
Iskanje ustvariš v navadnem tekstovnem kanalu, tja gredo tudi njegova obvestila. Prvi obhod
novega iskanja samo tiho posname trenutno stanje, da te ne zasuje s starimi oglasi.

## Razvoj lokalno (Node ≥ 24, pnpm)

```sh
pnpm install
pnpm test        # testi na shranjenih HTML fixturih
pnpm dev         # potrebuje DISCORD_TOKEN v okolju
```

Projekt je pripet na pnpm 9 (polje `packageManager`, `corepack enable` poskrbi za pravo
verzijo).

## Načrti

- [x] nepremicnine.net
- [ ] dodatni portali (npr. bolha.com) po potrebi

## Opombe

- Ukazi se ne prikažejo? Z nastavljenim `DISCORD_GUILD_ID` so na tvojem strežniku vidni takoj
  po zagonu bota; brez njega (globalna registracija) traja do ~1h.
- `/status` kaže 🔴? Stran trenutno zavrača zahteve. Bot se sam umakne (vsakič dlje, do 8 ur)
  in nadaljuje, ko mine; ničesar ni treba narediti.
- Iskanje gre čez vse strani filtra (varovalka pri 100 straneh), zato dobro filtriraj: ozek
  filter pomeni manj strani na obhod.
- Zgodovina cen je v SQLite tabeli `price_history`, če bi jo rad bral neposredno.

## Prispevanje

Issueji in pull requesti so dobrodošli. Pred PR-jem poženi `pnpm typecheck && pnpm test`
(isto preveri CI). Če se spremeni HTML strani in parser odpove, priloži svež (anonimiziran)
fixture v `test/fixtures/`: telefonske številke in imena kontaktov zamenjaj z izmišljenimi.

## Opozorilo

Špegavec ni povezan z nepremicnine.net ali njegovimi lastniki. Je osebno orodje za spremljanje
lastnih iskanj, zato ga uporabljaj zmerno in v skladu s pogoji uporabe strani. Odgovornost za
uporabo je tvoja.

## Licenca

MIT — glej [LICENSE](LICENSE).
