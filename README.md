<p align="center">
  <img src="assets/spegavec_logo.png" alt="Špegavec" width="280">
</p>

> **EN:** Špegavec (“the snoop”) is a self-hosted Discord bot that watches real-estate searches
> on the Slovenian portal [nepremicnine.net](https://www.nepremicnine.net) and notifies you about
> new listings and price changes. The docs below are in Slovenian, like its audience.

Samostojen špegavec nepremičninskih oglasov. Periodično pregleduje iskanja na
[nepremicnine.net](https://www.nepremicnine.net), si zapomni, kaj je že videl, in te ob vsakem
novem oglasu (ali spremembi cene) obvesti preko Discorda.

Iskanja dodajaš in upravljaš s slash ukazi, novi oglasi pa pridejo kot lepi embedi v kanal,
kjer si iskanje ustvaril.

Nastalo iz čiste lenobe: ne da se mi ročno osveževati strani cele dneve.

Obvestilo je embed s fotografijo, celim opisom in kontaktom, približno takole:

> 🟢 **Dober posel · center-2s**
> **[ČRNUČE, LJ. - BEŽIGRAD](https://www.nepremicnine.net)**
> Cena **224.000 €** · €/m² **6.871 €** · Velikost **32,6 m²** · Sobe **1-sobno** · Leto **2008**
> 💸 **16 % pod** mediano iskanja (8.200 €/m²)

Ob spremembi cene pride manjši embed: `240.000 € → 224.000 € (−6,7 %)`.

## Kako deluje

- Stran sedi za Cloudflareom. [`impit`](https://github.com/apify/impit) se predstavi kot pravi
  Chrome (TLS/HTTP2 prstni odtis) in gre skozi challenge brez brskalnika v ozadju.
- Obhod vsakih `POLL_MINUTES` (privzeto 20, z jitterjem). Vsako iskanje gre čez **vse strani**
  filtra, da ujame spremembe cen na vsakem oglasu, ne le na najnovejših. Ob blokadi se
  eksponentno umakne.
- Stanje v SQLite (`node:sqlite`, brez native odvisnosti): iskanja, videni oglasi, zgodovina cen.
- Vsak oglas dobi **€/m²**; dovolj pod mediano iskanja ga označi kot **🟢 dober posel**. Oglas,
  ki izgine za dva obhoda, se označi za **umaknjen/prodan**.

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

**Posodobitev** po spremembi kode: `git pull && pnpm install && pnpm build && systemctl restart spegavec`
(na strežniku zavito v ukaz `spegavec-update`).

## Discord ukazi

| Ukaz | Kaj naredi |
| --- | --- |
| `/iskanje dodaj ime: url:` | Spremljaj URL iskanja, prilepljen z nepremicnine.net (podpira vse filtre strani). |
| `/iskanje sestavi ime: posel: regija: tip: [sobnost:] [cena_min/max:] [velikost_min/max:] [letnik_min/max:]` | Sestaviš iskanje iz filtrov, ne da bi zapustil Discord. |
| `/iskanje seznam` | Pokaže iskanja in koliko oglasov sledijo. |
| `/iskanje odstrani\|ustavi\|nadaljuj ime:` | Upravljanje iskanj (imena se samodejno dopolnijo). |
| `/preveri [ime:]` | Naredi obhod takoj, brez čakanja na cikel. |
| `/status` | Zdravje špegavca in zadnji obhod po iskanjih. |
| `/zgodovina ime: oglas:` | Časovnica cene oglasa (oglas = ID ali poln URL). |

Obvestila gredo v kanal, kjer si iskanje ustvaril. Prvi obhod novega iskanja samo tiho posname
trenutno stanje, da te ne zasuje s starimi oglasi.

## Razvoj lokalno (Node ≥ 24, pnpm)

```sh
pnpm install
pnpm test        # testi na shranjenih HTML fixturih
pnpm dev         # potrebuje DISCORD_TOKEN v okolju
```

`LOG_LEVEL=debug` v `.env` izpiše tudi vsako pobrano stran in ponovne poskuse ob blokadi.

Projekt je pripet na pnpm 9 (polje `packageManager`, `corepack enable` poskrbi za pravo
verzijo).

## Načrti

- [x] nepremicnine.net
- [ ] dodatni portali (npr. bolha.com) po potrebi

## Opombe

- Ukazi se ne prikažejo? Z nastavljenim `DISCORD_GUILD_ID` so na tvojem strežniku vidni takoj
  po zagonu bota; brez njega (globalna registracija) traja do ~1h.
- `/status` kaže 🔴? Cloudflare blokada — bot se sam eksponentno umakne in nadaljuje, ko mine.
  Ničesar ni treba narediti.
- Pogosteje kot na ~10 minut prosiš za Cloudflare blokado; privzetih 20 minut ima nizek profil.
- Iskanje gre čez vse strani filtra (varovalka pri 100 straneh), zato dobro filtriraj: ozek
  filter pomeni manj strani na obhod.
- Cela zgodovina cen ostane v tabeli `price_history`.

## Licenca

MIT — glej [LICENSE](LICENSE).
