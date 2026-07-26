// Simulated inbound DMs. This is what stands in for the Instagram/WhatsApp
// integration — there is no Meta API anywhere in this project.
//
// Deliberate mix: vague browsers, specific price questions, and clear
// payment-ready buyers. Typos and Sheng/Swahili-English are intentional — they
// are what real Nairobi DMs look like, and they exercise the classifier.
//
// group 'drip' → trickled in slowly on page load so the inbox is never empty.
// group 'rush' → fired in quick succession by "Simulate morning rush".

export const INBOUND_SEED = [
  // ---------------------------------------------------------------- drip (3)
  {
    group: 'drip',
    buyerHandle: '@kevo_mwas',
    buyerName: 'Kevo Mwas',
    text: 'niaje bro, nimeona hizo watch kwa story. zinapatikana aje?',
    intent: 'cold',
  },
  {
    group: 'drip',
    buyerHandle: '@shiro.wangui',
    buyerName: 'Shiro Wangui',
    text: 'Hi! that rose gold one for ladies, iko bei gani? na ni original?',
    intent: 'warm',
  },
  {
    group: 'drip',
    buyerHandle: '@trucker_jose',
    buyerName: 'Jose Kimani',
    text: 'i need a watch ya kuvaa job, kazi ni driving. something strong isiharibike na maji',
    intent: 'warm',
  },

  // ---------------------------------------------------------------- rush (8)
  {
    group: 'rush',
    buyerHandle: '@mercy_atieno',
    buyerName: 'Mercy Atieno',
    text: 'bei?',
    intent: 'cold',
  },
  {
    group: 'rush',
    buyerHandle: '@bkg_collins',
    buyerName: 'Collins B',
    text: 'aksana, that seiko automatic. i wnat it. nitatuma till leo asubuhi, send number',
    intent: 'hot',
  },
  {
    group: 'rush',
    buyerHandle: '@nyar_kisumo',
    buyerName: 'Linet Achieng',
    text: 'juzi nimeona the fossil brown leather one. is it still there? and does it come na box?',
    intent: 'warm',
  },
  {
    group: 'rush',
    buyerHandle: '@dj_stano',
    buyerName: 'Stano',
    text: 'wagwan. just browsing tu, nikipata pesa month end nitakushow',
    intent: 'cold',
  },
  {
    group: 'rush',
    buyerHandle: '@wairimu_k',
    buyerName: 'Wairimu K',
    text: 'I WANT THE BLACK ONE 1800 ONE. how do i pay?? im in town right now',
    intent: 'hot',
  },
  {
    group: 'rush',
    buyerHandle: '@allan.oduor',
    buyerName: 'Allan Oduor',
    text: 'hey, whats the difference btwn the casio vintage na the skmei? which one ni bora for 2k',
    intent: 'warm',
  },
  {
    group: 'rush',
    buyerHandle: '@brendah_m',
    buyerName: 'Brendah M',
    text: 'sasa. nataka ile rose gold ya 3400 iwe gift, bday ya sis ni kesho. naweza lipa saa hii, nitumie till namba',
    intent: 'hot',
  },
  {
    group: 'rush',
    buyerHandle: '@ktm_rider',
    buyerName: 'Peter Njoroge',
    text: 'uko na apple watch straps? size 44',
    intent: 'cold',
  },

  // -------------------------------------------------------------- extra (1)
  // Not in either batch by default — handy for a manual "one more DM" tap.
  {
    group: 'extra',
    buyerHandle: '@tonny_wa_town',
    buyerName: 'Tonny',
    text: 'that rolex datejust silver ulipost, iko? i have cash ready 4500',
    intent: 'hot',
  },
];

export const dripMessages = () => INBOUND_SEED.filter((m) => m.group === 'drip');
export const rushMessages = () => INBOUND_SEED.filter((m) => m.group === 'rush');
