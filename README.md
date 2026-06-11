<p align="center">
  <img src="assets/spegavec_logo.png" alt="Špegavec" width="280">
</p>

Samostojen špegavec nepremičninskih oglasov. Periodično pregleduje iskanja na
[nepremicnine.net](https://www.nepremicnine.net), si zapomni, kaj je že videl, in te ob vsakem
novem oglasu (ali spremembi cene) zbudi prek Discorda.

V praksi to pomeni: iskanja dodajaš in upravljaš s slash ukazi, novi oglasi pa pridejo kot lepi
embedi v kanal, kjer si iskanje ustvaril.

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
- Špegavec naredi obhod vsakih `POLL_MINUTES` (privzeto 20) z ±20 % jitterja in pri vsakem
  iskanju gre čez **vse strani** filtra (naključni 2 do 5 s premori med stranmi), da ujame
  spremembe cen na čisto vsakem oglasu, ne le na najnovejših. Ob blokadi se eksponentno umakne
  (do 8x) in dobiš eno samo opozorilo na epizodo.
- Prvi obhod novega iskanja samo posname trenutno stanje, da te ne zasuje s starimi oglasi.

## Arhitektura

Plasti tečejo od zajema do obvestila, vsaka pozna samo tisto pod sabo:

```
scraper   zajame in sparsa oglase s portala
  fetcher (impit/Cloudflare) -> crawler (po straneh) -> parser (HTML v Listing) -> urlBuilder (filtri v URL)
   |
poller    periodično požene scraper, primerja z bazo, javi razliko
   |
store     SQLite: iskanja, videni oglasi, zgodovina cen (dedup + spremembe cen)
   |
discord   slash ukazi (vmesnik) + embedi (obvestila)
```

## Struktura projekta

```
src/
  index.ts          zagon: poveže config, store, scraper, poller, bota
  config.ts         branje okoljskih spremenljivk
  core/
    types.ts        Listing, Watch, SearchFilters, PollResult
    poller.ts       cikel obhodov, umik ob blokadi
  scraper/
    fetcher.ts      HTTP prek impit (gre skoz Cloudflare)
    crawler.ts      sprehod po straneh rezultatov + dedup
    parser.ts       HTML rezultatov v Listing[]   <- specifično za nepremicnine.net
    urlBuilder.ts   SearchFilters v URL iskanja    <- specifično za nepremicnine.net
  store/
    db.ts           shema + odpiranje SQLite
    repo.ts         WatchRepo, ListingRepo (poizvedbe, dedup, zgodovina cen)
  discord/
    commands.ts     definicije slash ukazov (regije, tipi, sobnosti)
    bot.ts          obravnava ukazov, pošiljanje obvestil
    embeds.ts       izgled oglasa/spremembe cene v Discordu
test/               testi parserja in shrambe na shranjenih HTML fixturih
```

## Discord ukazi

| Ukaz                                                                                                                   | Kaj naredi                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/iskanje dodaj ime: url:`                                                                                   | Spremljaj poljuben URL iskanja, prilepljen s strani, podpira **vse** filtre, kar jih stran ima. Nastaviš filtre na nepremicnine.net, kopiraš naslovno vrstico, prilepiš. |
| `/iskanje sestavi ime: posel: regija: tip: [sobnost:] [cena_min/max:] [velikost_min/max:] [letnik_min/max:]` | Sestaviš iskanje iz filtrov, brez da zapustiš Discord.                                                                                                                   |
| `/iskanje seznam`                                                                                                      | Pokaže iskanja in koliko oglasov sledijo.                                                                                                                                |
| `/iskanje odstrani\|ustavi\|nadaljuj ime:`                                                                             | Upravljanje iskanj (imena se samodejno dopolnijo).                                                                                                                       |
| `/preveri [ime:]`                                                                                                      | Naredi obhod takoj, brez čakanja na cikel.                                                                                                                               |
| `/status`                                                                                                              | Zdravje špegavca (vključno z blokado Cloudflare) in zadnji obhod po iskanjih.                                                                                            |

`dodaj` in `sestavi` URL preverita z živo poizvedbo in ti vrneta trenutno število zadetkov,
tak da ujameš tipkarsko napako v regiji ali nemogočo kombinacijo filtrov takoj. Obvestila
gredo v kanal, kjer si iskanje ustvaril. Če hočeš, daj različna iskanja v različne kanale.

## Postavitev

### 1. Naredi Discord bota

1. <https://discord.com/developers/applications> → **New Application**, vpiši ime, **Create**.
   Bot user se ustvari samodejno z aplikacijo (ni več gumba "Add Bot").
2. Zavihek **Bot** → **Reset Token** → kopiraj (to je `DISCORD_TOKEN`). Privilegiranih intentov
   (Message Content ipd.) ne rabiš, pusti jih ugasnjene; bot dela samo prek slash ukazov.
3. Zavihek **Installation**:
   - **Installation Contexts**: odkljukaj **User Install**, pusti samo **Guild Install** (rabimo
     bota v strežniku, ne kot user-app).
   - **Install Link** → izberi **Discord Provided Link**.
   - **Default Install Settings** (za Guild Install): scope-a `bot` + `applications.commands`, pod
     `bot` pa pravici **Send Messages** in **Embed Links**. Shrani.
   - Kopiraj Install Link, ga prilepi v brskalnik → **Add to Server** → izberi svoj strežnik.
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

## Načrti

- [x] nepremicnine.net
- [ ] podpora za dodatne nepremičninske portale (npr. bolha.com, salesofia, nepremicnine24)
      po potrebi v prihodnosti

## Opombe in meje

- Pogosteje ko na ~10 minut kličeš stran prosiš za Cloudflare blokado; privzetih 20 minut z
  jitterjem ima nizek profil.
- Če te Cloudflare vseeno blokira, ti bot enkrat pove, se umakne in si sam opomore. Če bi
  blokade postale trajne, je morda treba osvežit prstne odtise v `impit` (`pnpm update impit`).
- Vsako iskanje gre čez vse strani filtra (zaznava konca je samodejna, varovalka pri 100
  straneh = 2500 oglasov). Zato je smiselno iskanja dobro pofiltrirat: ozek filter pomeni manj
  strani na obhod in nižji profil. Za npr. eno regijo s cenovno mejo je to nekaj strani.
- Sprememba cene se primerja z zadnjo shranjeno ceno na katerem koli zajetem oglasu (ne le
  najnovejših), cela zgodovina ostane v tabeli `price_history`, če bi kdaj hotel risat graf.
