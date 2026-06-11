<p align="center">
  <img src="assets/spegavec_logo.png" alt="Špegavec" width="280">
</p>

Discord bot, ki špega nove oglase na [nepremicnine.net](https://www.nepremicnine.net) in jih
sproti meče v Discord. Bot je cel vmesnik, iskanja dodajaš in upravljaš s slash ukazi, novi
oglasi (in spremembe cen) pa pridejo kot lepi embedi v kanal, kjer si iskanje ustvaril.

Nastalo iz čiste sitnosti: dobre stanovanja gredo mimo v parih urah, ročno osveževat stran pa
se ne da cele dneve.

## Kak dela

- **Brez brskalnika v ozadju.** Stran sedi za Cloudflareom, ki navadne HTTP kliente vrže ven.
  [`impit`](https://github.com/apify/impit) se predstavi kot pravi Chrome (TLS/HTTP2 prstni
  odtis) in gre skoz challenge z drobcem virov, ki bi jih požrl Playwright.
- Oglasi se berejo iz HTML-ja, ki ga vrne strežnik, rajš iz schema.org microdata
  (`itemprop=price` ipd.) ko iz krhkih CSS klas.
- Stanje je v SQLite (Nodeov vgrajeni `node:sqlite`, brez native odvisnosti): iskanja, videni
  oglasi po iskanju in cela zgodovina cen.
- Špegavec naredi obhod vsakih `POLL_MINUTES` (privzeto 20) z ±20 % jitterja, vsako iskanje
  pregleda po straneh z naključnimi 2 do 5 s premori in se eksponentno umakne (do 8x), če
  Cloudflare začne blokirat, pa dobiš eno samo opozorilo na epizodo blokade.
- Prvi obhod novega iskanja samo posname trenutno stanje, da te ne zasuje s starimi oglasi.

## Discord ukazi

| Ukaz                                                                                                                   | Kaj naredi                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/iskanje dodaj ime: url: [strani:]`                                                                                   | Spremljaj poljuben URL iskanja, prilepljen s strani, podpira **vse** filtre, kar jih stran ima. Nastaviš filtre na nepremicnine.net, kopiraš naslovno vrstico, prilepiš. |
| `/iskanje sestavi ime: posel: regija: tip: [sobnost:] [cena_min/max:] [velikost_min/max:] [letnik_min/max:] [strani:]` | Sestaviš iskanje iz filtrov, brez da zapustiš Discord.                                                                                                                   |
| `/iskanje seznam`                                                                                                      | Pokaže iskanja in koliko oglasov sledijo.                                                                                                                                |
| `/iskanje odstrani\|ustavi\|nadaljuj ime:`                                                                             | Upravljanje iskanj (imena se samodejno dopolnijo).                                                                                                                       |
| `/preveri [ime:]`                                                                                                      | Naredi obhod takoj, brez čakanja na cikel.                                                                                                                               |
| `/status`                                                                                                              | Zdravje špegavca (vključno z blokado Cloudflare) in zadnji obhod po iskanjih.                                                                                            |

`dodaj` in `sestavi` URL preverita z živo poizvedbo in ti vrneta trenutno število zadetkov,
tak da ujameš tipkarsko napako v regiji ali nemogočo kombinacijo filtrov takoj. Obvestila
gredo v kanal, kjer si iskanje ustvaril. Če hočeš, daj različna iskanja v različne kanale.

## Postavitev

### 1. Naredi Discord bota

1. <https://discord.com/developers/applications> → **New Application**.
2. Zavihek **Bot** → **Reset Token** → kopiraj (to je `DISCORD_TOKEN`).
3. Zavihek **Installation** → Install Link → izberi scope-a `bot` + `applications.commands`,
   bot pravici **Send Messages** in **Embed Links** → odpri generiran URL in povabi bota na
   svoj strežnik.
4. V Discordu vklopi Developer Mode (Settings → Advanced), desni klik na ikono strežnika →
   **Copy Server ID** (to je `DISCORD_GUILD_ID`).

### 2. Poženi

```sh
cp .env.example .env   # vpiši DISCORD_TOKEN in DISCORD_GUILD_ID
docker compose up -d --build
docker compose logs -f # mora izpisat "Prijavljen kot ..." in "Obhod vsakih ~20 min"
```

SQLite baza se hrani v `./data/` na hostu.

### Razvoj lokalno (Node ≥ 24, pnpm)

```sh
pnpm install
pnpm test        # testi parserja tečejo na shranjenih HTML fixturih
pnpm dev         # rabi DISCORD_TOKEN v okolju
```

## Na Proxmoxu

Karkoli zna pognat Docker, dela; najlažji je LXC kontejner:

1. Naredi LXC iz Debian 12 predloge (1 vCPU, 512 MB RAM, 4 GB diska je čist dovolj).
   Za Docker-v-LXC vklopi **Options → Features → nesting=1** (in keyctl=1, če je neprivilegiran).
2. Notr v kontejnerju:

   ```sh
   apt update && apt install -y curl git
   curl -fsSL https://get.docker.com | sh
   git clone <ta repo> /opt/spegavec
   cd /opt/spegavec
   cp .env.example .env && nano .env
   docker compose up -d --build
   ```

3. Pa to je to, kontejner sam restarta bota (`restart: unless-stopped`), LXC pa lahko backupaš
   ko vsak drug Proxmox gost.

## Opombe in meje

- Pogosteje ko na ~10 minut kličeš stran prosiš za Cloudflare blokado; privzetih 20 minut z
  jitterjem ima nizek profil (par nalaganj strani na cikel).
- Če te Cloudflare vseeno blokira, ti bot enkrat pove, se umakne in si sam opomore. Če bi
  blokade postale trajne, je morda treba osvežit prstne odtise v `impit` (`pnpm update impit`).
- `strani` na iskanje je privzeto 3 (75 najnovejših oglasov). Novi oglasi se pojavijo na vrhu,
  tak da je malo strani dovolj, razen če filtri zajamejo ogromno območje.
- Sprememba cene se primerja z zadnjo shranjeno ceno; cela zgodovina ostane v tabeli
  `price_history`, če bi kdaj hotel risat graf.
