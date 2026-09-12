import { SlashCommandBuilder } from "discord.js";

export const REGIONS = [
  "ljubljana-mesto",
  "ljubljana-okolica",
  "gorenjska",
  "juzna-primorska",
  "severna-primorska",
  "notranjska",
  "savinjska",
  "podravska",
  "pomurska",
  "koroska",
  "dolenjska",
  "posavska",
  "zasavska",
] as const;

export const PROPERTY_TYPES = [
  "stanovanje",
  "hisa",
  "vikend",
  "posest",
  "poslovni-prostor",
  "garaza",
] as const;

// prikazno ime → slug, ki ga stran uporablja za velikost stanovanja
export const ROOM_CHOICES: { name: string; value: string }[] = [
  { name: "garsonjera", value: "garsonjera" },
  { name: "1-sobno", value: "1-sobno" },
  { name: "1,5-sobno", value: "15-sobno" },
  { name: "2-sobno", value: "2-sobno" },
  { name: "2,5-sobno", value: "25-sobno" },
  { name: "3-sobno", value: "3-sobno" },
  { name: "3,5-sobno", value: "35-sobno" },
  { name: "4-sobno", value: "4-sobno" },
  { name: "4,5-sobno", value: "45-sobno" },
  { name: "5 in večsobno", value: "5-in-vecsobno" },
];

export function buildCommands() {
  const iskanje = new SlashCommandBuilder()
    .setName("iskanje")
    .setDescription("Upravljanje iskanj na nepremicnine.net")
    .addSubcommand((sub) =>
      sub
        .setName("dodaj")
        .setDescription("Spremljaj URL iskanja, prilepljen z nepremicnine.net (podpira vse filtre strani)")
        .addStringOption((opt) =>
          opt.setName("ime").setDescription("Kratko unikatno ime iskanja").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("url")
            .setDescription("URL rezultatov z nepremicnine.net (nastavi filtre na strani, kopiraj URL)")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => {
      sub
        .setName("sestavi")
        .setDescription("Sestavi iskanje iz filtrov, ne da bi zapustil Discord")
        .addStringOption((opt) =>
          opt.setName("ime").setDescription("Kratko unikatno ime iskanja").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("posel")
            .setDescription("Prodaja ali oddaja")
            .setRequired(true)
            .addChoices({ name: "prodaja", value: "prodaja" }, { name: "oddaja", value: "oddaja" }),
        )
        .addStringOption((opt) =>
          opt
            .setName("regija")
            .setDescription("Regija (ali vpiši slug pod-regije, kot ga ima stran)")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) => {
          opt.setName("tip").setDescription("Vrsta nepremičnine").setRequired(true);
          for (const type of PROPERTY_TYPES) opt.addChoices({ name: type, value: type });
          return opt;
        })
        .addStringOption((opt) => {
          opt.setName("sobnost").setDescription("Velikost stanovanja (samo za stanovanje)");
          for (const rooms of ROOM_CHOICES) opt.addChoices(rooms);
          return opt;
        })
        .addIntegerOption((opt) => opt.setName("cena_min").setDescription("Najnižja cena (EUR)"))
        .addIntegerOption((opt) => opt.setName("cena_max").setDescription("Najvišja cena (EUR)"))
        .addIntegerOption((opt) => opt.setName("velikost_min").setDescription("Najmanjša velikost (m²)"))
        .addIntegerOption((opt) => opt.setName("velikost_max").setDescription("Največja velikost (m²)"))
        .addIntegerOption((opt) => opt.setName("letnik_min").setDescription("Najstarejši letnik"))
        .addIntegerOption((opt) => opt.setName("letnik_max").setDescription("Najnovejši letnik"));
      return sub;
    })
    .addSubcommand((sub) => sub.setName("seznam").setDescription("Pokaži vsa iskanja"))
    .addSubcommand((sub) =>
      sub
        .setName("odstrani")
        .setDescription("Odstrani iskanje")
        .addStringOption((opt) =>
          opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("ustavi")
        .setDescription("Začasno ustavi iskanje")
        .addStringOption((opt) =>
          opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("nadaljuj")
        .setDescription("Spet zaženi ustavljeno iskanje")
        .addStringOption((opt) =>
          opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
        ),
    );

  const preveri = new SlashCommandBuilder()
    .setName("preveri")
    .setDescription("Naredi obhod takoj, brez čakanja na naslednji cikel")
    .addStringOption((opt) =>
      opt.setName("ime").setDescription("Samo to iskanje (privzeto: vsa)").setAutocomplete(true),
    );

  const status = new SlashCommandBuilder()
    .setName("status")
    .setDescription("Pokaži zdravje špegavca in statistiko po iskanjih");

  const zgodovina = new SlashCommandBuilder()
    .setName("zgodovina")
    .setDescription("Pokaži zgodovino cene oglasa")
    .addStringOption((opt) =>
      opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("oglas")
        .setDescription("ID oglasa ali njegov URL z nepremicnine.net")
        .setRequired(true),
    );

  const povzetek = new SlashCommandBuilder()
    .setName("povzetek")
    .setDescription("Povzetek dogajanja: novi, umaknjeni, spremembe cen in smer cen")
    .addStringOption((opt) =>
      opt
        .setName("obdobje")
        .setDescription("Za koliko nazaj (privzeto: teden)")
        .addChoices(
          { name: "teden", value: "teden" },
          { name: "mesec", value: "mesec" },
          { name: "leto", value: "leto" },
        ),
    )
    .addStringOption((opt) =>
      opt.setName("ime").setDescription("Samo to iskanje (privzeto: vsa)").setAutocomplete(true),
    );

  const posli = new SlashCommandBuilder()
    .setName("posli")
    .setDescription("Trenutno najcenejši aktivni oglasi po €/m² glede na mediano iskanja")
    .addStringOption((opt) =>
      opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
    )
    .addIntegerOption((opt) =>
      opt.setName("stevilo").setDescription("Koliko oglasov (privzeto 5, največ 10)").setMinValue(1).setMaxValue(10),
    );

  const izvoz = new SlashCommandBuilder()
    .setName("izvoz")
    .setDescription("Izvozi podatke iskanja kot CSV")
    .addStringOption((opt) =>
      opt.setName("ime").setDescription("Ime iskanja").setRequired(true).setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("kaj")
        .setDescription("Kaj izvoziti (privzeto: oglasi)")
        .addChoices({ name: "oglasi", value: "oglasi" }, { name: "cene", value: "cene" }),
    );

  return [iskanje, preveri, status, zgodovina, povzetek, posli, izvoz].map((command) => command.toJSON());
}
