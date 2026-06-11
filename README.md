<p align="center">
  <img src="assets/spegavec_logo.png" alt="Špegavec" width="280">
</p>

Samostojen špegavec nepremičninskih oglasov. Periodično pregleduje iskanja na
[nepremicnine.net](https://www.nepremicnine.net), si zapomni, kaj je že videl, in te ob vsakem
novem oglasu (ali spremembi cene) zbudi prek Discorda.

Iskanja dodajaš in upravljaš s slash ukazi, novi oglasi pa pridejo kot lepi embedi v kanal,
kjer si iskanje ustvaril.

Nastalo iz čiste lenobe: ne da se mi ročno osveževati strani cele dneve.

## Kak dela

- Stran sedi za Cloudflareom. [`impit`](https://github.com/apify/impit) se predstavi kot pravi
  Chrome (TLS/HTTP2 prstni odtis) in gre skoz challenge brez brskalnika v ozadju.
- Obhod vsakih `POLL_MINUTES` (privzeto 20, z jitterjem). Vsako iskanje gre čez **vse strani**
  filtra, da ujame spremembe cen na vsakem oglasu, ne le na najnovejših. Ob blokadi se
  eksponentno umakne.
- Stanje v SQLite (`node:sqlite`, brez native odvisnosti): iskanja, videni oglasi, zgodovina cen.
- Vsak oglas dobi **€/m²**; dovolj pod mediano iskanja ga označi kot **🟢 dober posel**. Oglas,
  ki izgine za dva obhoda, se označi za **umaknjen/prodan**.

## Discord ukazi

| Ukaz | Kaj naredi |
| --- | --- |
| `/iskanje dodaj ime: url:` | Spremljaj URL iskanja, prilepljen z nepremicnine.net (podpira vse filtre strani). |
| `/iskanje sestavi ime: posel: regija: tip: [sobnost:] [cena_min/max:] [velikost_min/max:] [letnik_min/max:]` | Sestaviš iskanje iz filtrov, brez da zapustiš Discord. |
| `/iskanje seznam` | Pokaže iskanja in koliko oglasov sledijo. |
| `/iskanje odstrani\|ustavi\|nadaljuj ime:` | Upravljanje iskanj (imena se samodejno dopolnijo). |
| `/preveri [ime:]` | Naredi obhod takoj, brez čakanja na cikel. |
| `/status` | Zdravje špegavca in zadnji obhod po iskanjih. |
| `/zgodovina ime: oglas:` | Časovnica cene oglasa (oglas = ID ali poln URL). |

Obvestila gredo v kanal, kjer si iskanje ustvaril. Prvi obhod novega iskanja samo tiho posname
trenutno stanje, da te ne zasuje s starimi oglasi.

## Discord bot

1. <https://discord.com/developers/applications> → **New Application**. Bot user se ustvari
   samodejno.
2. **Bot** → **Reset Token** → to je `DISCORD_TOKEN`. Privilegiranih intentov ne rabiš.
3. **Installation**: pusti samo **Guild Install**, **Install Link** → **Discord Provided Link**,
   scope-a `bot` + `applications.commands`, pravici **Send Messages** + **Embed Links**. Odpri
   link in povabi bota na strežnik.
4. Developer Mode → desni klik na strežnik → **Copy Server ID** → to je `DISCORD_GUILD_ID`.

## Zagon (LXC + systemd)

Teče direktno v LXC kontejnerju, brez Dockerja.

```sh
# Node 24 + git v LXC
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git
corepack enable

# koda + konfiguracija
git clone <repo> /opt/spegavec && cd /opt/spegavec
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

## Razvoj lokalno (Node ≥ 24, pnpm)

```sh
pnpm install
pnpm test        # testi na shranjenih HTML fixturih
pnpm dev         # rabi DISCORD_TOKEN v okolju
```

`LOG_LEVEL=debug` v `.env` izpiše tudi vsako pobrano stran in ponovne poskuse ob blokadi.

## Načrti

- [x] nepremicnine.net
- [ ] dodatni portali (npr. bolha.com) po potrebi

## Opombe

- Pogosteje ko na ~10 minut prosiš za Cloudflare blokado; privzetih 20 minut ima nizek profil.
- Iskanje gre čez vse strani filtra (varovalka pri 100 straneh), zato dobro pofiltriraj: ozek
  filter pomeni manj strani na obhod.
- Cela zgodovina cen ostane v tabeli `price_history`.
