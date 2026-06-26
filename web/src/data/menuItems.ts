export type MenuCategory =
  | 'draft-beer'
  | 'soft-drinks'
  | 'coffee'
  | 'tea'
  | 'rum'
  | 'whisky'
  | 'gin'
  | 'vodka'
  | 'liqueurs'
  | 'metaxa'
  | 'tequila'
  | 'aperitifs'
  | 'wine'
  | 'sparkling-wine'
  | 'tatratea'
  | 'food-snacks';

export type MenuItem = {
  id: string;
  name: string;
  category: MenuCategory;
  points: number;
  alcoholic: boolean;
  tags: string[];
};

export const MENU_CATEGORY_POINTS: Record<MenuCategory, number> = {
  'draft-beer': 50,
  'soft-drinks': 50,
  coffee: 45,
  tea: 45,
  rum: 60,
  whisky: 60,
  gin: 60,
  vodka: 60,
  liqueurs: 60,
  metaxa: 60,
  tequila: 60,
  aperitifs: 60,
  wine: 55,
  'sparkling-wine': 70,
  tatratea: 75,
  'food-snacks': 80,
};

export const MENU_CATEGORY_LABELS: Record<MenuCategory, string> = {
  'draft-beer': 'Točené pivo',
  'soft-drinks': 'Nealko',
  coffee: 'Káva',
  tea: 'Čaj',
  rum: 'Rum',
  whisky: 'Whisky',
  gin: 'Gin',
  vodka: 'Vodka',
  liqueurs: 'Likéry',
  metaxa: 'Metaxa',
  tequila: 'Tequila',
  aperitifs: 'Aperitivy',
  wine: 'Víno',
  'sparkling-wine': 'Šumivé víno',
  tatratea: 'Tatratea',
  'food-snacks': 'Jídlo / chuťovky',
};

export const MENU_CATEGORY_ORDER: MenuCategory[] = [
  'draft-beer',
  'soft-drinks',
  'coffee',
  'tea',
  'rum',
  'whisky',
  'gin',
  'vodka',
  'liqueurs',
  'metaxa',
  'tequila',
  'aperitifs',
  'wine',
  'sparkling-wine',
  'tatratea',
  'food-snacks',
];

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('cs')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[%°*]+/g, '')
    .replace(/&/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function item(category: MenuCategory, name: string, tags: string[] = []): MenuItem {
  return {
    id: `${category}-${slugify(name)}`,
    name,
    category,
    points: MENU_CATEGORY_POINTS[category],
    alcoholic: !['soft-drinks', 'coffee', 'tea', 'food-snacks'].includes(category),
    tags,
  };
}

const draftBeer = ['Radegast 12°', 'Poutník 12°', 'Polička 11°'].map((name) => item('draft-beer', name));

const tatratea = [
  '17% Mléčný',
  '22% Kokos',
  '27% Acai & Aronie',
  '32% Citrus',
  '37% Červený čaj',
  '42% Broskev',
  '47% Šípek',
  '52% Original',
  '57% Šípek & Rakytník',
  '62% Lesní plody',
  '67% Jablko & Hruška',
  '72% Bezpráví',
].map((name) => item('tatratea', name, name.startsWith('72%') ? ['strong', 'bezpravi-72'] : []));

const food = [
  'Klobásek',
  'Oštěpek',
  'Grilovaný hermelín',
  'Nakládaný hermelín',
  'Utopenec',
  'Uzené maso',
  'Pečivo',
].map((name) => item('food-snacks', name));

const softDrinks = [
  ['Točená limonáda 0.3', ['lemonade']],
  ['Točená limonáda 0.5', ['lemonade']],
  ['Domácí limonáda', ['lemonade']],
  ['Cola', []],
  ['Tonic', []],
  ['Ginger Ale', []],
  ['Rose Lemonade', ['lemonade']],
  ['Mattoni', []],
  ['Red Bull', []],
  ['Juice', []],
] satisfies Array<[string, string[]]>;

const coffeeAndTea = [
  item('coffee', 'Espresso', ['espresso', 'caffeine']),
  item('coffee', 'Cappuccino', ['cappuccino', 'caffeine']),
  item('coffee', 'Latte Macchiato', ['latte', 'caffeine']),
  item('tea', 'Tea 0.25', ['tea', 'caffeine']),
  item('tea', 'Tea 0.5', ['tea', 'caffeine']),
];

const rums = [
  'Bacardi Blanca',
  'Bacardi Razz',
  'Captain Morgan Spiced',
  'Heffron',
  'Don Papa',
  'Diplomatico Reserva',
  'Plantation XO',
  'Pyrat XO',
  'Ron Zacapa',
  'Abuelo',
  'El Dorado',
  'Legendario',
  'Pampero',
  'Flor de Cana',
  'Mount Gay XO',
  'Dos Maderas',
  'Kirk & Sweeney',
  'A.H. Riise',
  'Santos Dumont',
  'Flying Dutchman',
].map((name) => item('rum', name));

const whiskies = [
  'Four Roses',
  'Jack Daniels',
  'Jack Daniels Honey',
  'Jack Daniels Fire',
  'Jack Daniels Apple',
  'Jim Beam',
  'Tullamore Dew',
  'Jameson',
  'Bushmills',
  'Aerstone',
  'Grants',
  'Glenfiddich 12',
  'Glenfiddich 15',
  'Laphroaig',
].map((name) => item('whisky', name));

const gins = [
  'Beefeater',
  'Beefeater Orange',
  'Bombay Sapphire',
  'ETSU',
  'ETSU Ocean',
  'ETSU Yuzu',
  'ETSU Orange',
  'Zafiro',
  'Zafiro Pink',
].map((name) => item('gin', name));

const vodkas = ['Finlandia', 'Absolut Vanilia', 'Russian Standard', 'Amundsen', 'Ruská Zelený Ječmen'].map((name) =>
  item('vodka', name),
);

const wines = [
  'Bílé víno',
  'Červené víno',
  'Růžové víno',
  'Veltlínské zelené',
  'Ryzlink vlašský',
  'Frankovka',
  'Svatovavřinecké',
].map((name) => item('wine', name));

const sparklingWines = ['Prosecco', 'Bohemia Sekt', 'Frizzante'].map((name) => item('sparkling-wine', name));

const aperitifs = ['Aperol', 'Campari', 'Martini Bianco', 'Martini Rosso', 'Fernet Stock', 'Fernet Citrus', 'Becherovka'].map(
  (name) => item('aperitifs', name),
);

const tequilas = ['Olmeca Blanco', 'Olmeca Gold', 'Sierra Silver', 'Sierra Reposado'].map((name) => item('tequila', name));

const metaxa = ['Metaxa 5*', 'Metaxa 7*', 'Metaxa 12*'].map((name) => item('metaxa', name));

const liqueurs = ['Jägermeister', 'Baileys', 'Malibu', 'Amaretto', 'Griotka', 'Vaječný likér', 'Zelená', 'Peprmintka'].map(
  (name) => item('liqueurs', name),
);

export const MENU_ITEMS: MenuItem[] = [
  ...draftBeer,
  ...softDrinks.map(([name, tags]) => item('soft-drinks', name, tags)),
  ...coffeeAndTea,
  ...rums,
  ...whiskies,
  ...gins,
  ...vodkas,
  ...liqueurs,
  ...metaxa,
  ...tequilas,
  ...aperitifs,
  ...wines,
  ...sparklingWines,
  ...tatratea,
  ...food,
];

export const MENU_ITEM_BY_ID = new Map(MENU_ITEMS.map((menuItem) => [menuItem.id, menuItem]));
