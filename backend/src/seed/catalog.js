// James's watch catalog. Prices in KES. This is the ONLY source of truth for
// prices/availability — it is passed verbatim into every Claude prompt so the
// model cannot invent items or numbers.
export const CATALOG_SEED = [
  {
    name: 'Casio Vintage A168',
    price: 2200,
    available: true,
    description: 'Silver retro digital, stainless steel bracelet. Unisex, very light. Fast mover.',
  },
  {
    name: 'Seiko 5 Automatic SNK809',
    price: 7800,
    available: true,
    description: 'Black dial automatic, canvas strap. No battery needed. Our top-end piece.',
  },
  {
    name: 'Curren Black Leather 8225',
    price: 1800,
    available: true,
    description: 'Big black face, brown leather strap. Chunky office look, popular with guys.',
  },
  {
    name: 'Naviforce Rose Gold NF9100',
    price: 3400,
    available: true,
    description: 'Rose gold steel bracelet, date window. Popular gift for ladies.',
  },
  {
    name: 'Skmei Digital Sport 1251',
    price: 1500,
    available: true,
    description: 'Rubber strap digital, water resistant, backlight. Good for gym and boda.',
  },
  {
    name: 'Fossil Grant Chronograph',
    price: 8000,
    available: true,
    description: 'Brown leather chronograph, roman numerals. Smart-casual, comes with box.',
  },
  {
    name: 'Rolex Datejust Homage (silver)',
    price: 4500,
    available: false,
    description: 'Silver jubilee bracelet homage piece. SOLD OUT — restock not confirmed.',
  },
  {
    name: 'Apple Watch SE Strap Bundle',
    price: 2600,
    available: false,
    description: 'Pack of 3 silicone straps, 44mm. OUT OF STOCK until next shipment.',
  },
];
