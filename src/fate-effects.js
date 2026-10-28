import { randomUnitInterval } from './roulette.js';
import { localizedItemName } from './i18n.js';
import { isBuildEntrySealed } from './build-fate.js';
import { FATE_PRESENTATION } from './fate-presentation.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const assetURL = path => new URL(`../${path}`, import.meta.url).href;

export const SEALED_ITEM_SVG = '<svg viewBox="0 0 72 72" fill="none" aria-hidden="true"><path d="M18 18h36v42H18z" stroke="currentColor" stroke-width="1.5"/><path d="m24 14 4-8 8 7 8-7 4 8M24 27h24M24 52h24" stroke="currentColor" stroke-width="1.5"/><path d="M28 38a8 8 0 0 1 16 0c0 5-8 4-8 10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="36" cy="55" r="1.5" fill="currentColor"/></svg>';
const CHICKEN_SVG = '<svg class="fate-chicken" viewBox="0 0 260 225" aria-hidden="true"><ellipse cx="123" cy="204" rx="78" ry="9" fill="#000" opacity=".25"/><g class="chicken-legs" fill="none" stroke="#e3a849" stroke-width="8" stroke-linecap="round"><path d="m106 167-4 31-17 4m17-4 10 6M141 170l4 29 18 3m-18-3-9 6"/></g><g class="chicken-body"><path d="M67 111C37 88 39 59 27 55c-8 20 1 41 9 57-19-11-23-1-18 14 7 17 27 25 48 22" fill="#b7a5bc" stroke="#543d5e" stroke-width="3"/><path d="M52 129c0-47 32-72 84-65 57 8 65 68 34 100-24 25-102 30-117-19" fill="#f2e7d4" stroke="#564052" stroke-width="3"/><path d="M64 143c33 25 87 19 111-5-5 35-90 51-112 8" fill="#d4c8b9"/><path class="chicken-wing" d="M82 102c18-18 57-11 57 18-1 36-43 36-57 12 18 10 34 5 36-6-6 7-24 3-29-3 19 5 29-3 20-12" fill="#d6c2ad" stroke="#947563" stroke-width="3" stroke-linejoin="round"/><g class="chicken-head"><path d="M152 61c-14-24-8-33-2-34 8-1 14 12 16 20 2-29 12-36 18-27 6 8-1 23-4 30 21-20 33-19 33-10-1 10-19 15-25 19" fill="#d8646a" stroke="#81414c" stroke-width="3"/><path d="M172 53c-29 0-44 26-34 53 11 29 55 29 72 0 13-22 0-53-38-53" fill="#f8eddb" stroke="#564052" stroke-width="3"/><path d="M199 95c9 9 24 6 23 0-3-6-15-12-24-13" fill="#eab152" stroke="#9c743e" stroke-width="2"/><path d="M186 106c4 26 18 33 21 21 3-13-6-23-12-24" fill="#cc5d6d" stroke="#81414c" stroke-width="2"/><ellipse cx="173" cy="81" rx="12" ry="14" fill="#fff8e5" stroke="#a69a89" stroke-width="1.5"/><ellipse class="chicken-eye" cx="179" cy="83" rx="5" ry="7" fill="#302535"/><circle cx="181" cy="80" r="1.5" fill="#fff"/><path d="m156 66 23-7" fill="none" stroke="#786064" stroke-width="4" stroke-linecap="round"/></g></g></svg>';
const DIE_SVG = '<svg viewBox="0 0 200 200" aria-hidden="true"><path d="m99 10 66 37 25 73-48 66-72 3-57-59 12-75Z" fill="#292031" stroke="#e1c18b" stroke-width="2"/><path d="m99 10 4 48-58 41-20-44m20 44 25 90m33-131 55 42 7-53m-7 53 32 20m-32-20-22 55 6 31m-6-31-61 3-30-59m29 59-4 31" fill="none" stroke="#aa899e" stroke-width="1.5"/><path d="m103 58 55 42-22 55-61 3-30-59Z" fill="#574044" stroke="#d8b786" stroke-width="1.5"/></svg>';
const KING_SVG = '<svg viewBox="0 0 180 180" fill="none" aria-hidden="true"><path d="m36 56 18-31 35 31 37-31 18 31-9 42H45Z" fill="#342a41" stroke="#ddc59a" stroke-width="2"/><path d="M51 102h78v48H51z" fill="#221a2d" stroke="#c1a1d3" stroke-width="1.5"/><path d="M66 116c18-16 33-16 49 0-18 16-33 16-49 0Z" stroke="#d5b1df" stroke-width="2"/><path d="m64 140 54-44" stroke="#d9c298" stroke-width="3"/><circle cx="90" cy="48" r="5" fill="#dfc391"/></svg>';
const MOTHER_SVG = '<svg viewBox="0 0 180 180" fill="none" aria-hidden="true"><path d="M90 15c-30 0-54 55-59 117h118C141 69 120 15 90 15Z" fill="#332d37" stroke="#dfc496" stroke-width="2"/><path d="M59 62c0-22 61-22 61 0-3 33-16 49-30 49S61 89 59 62Z" fill="#d9c4ad"/><path d="M68 63h44M89 67v21m-10 8h22" stroke="#514051" stroke-width="2"/><path d="M50 138c24-16 56-16 80 0M42 151h96" stroke="#d6b985" stroke-width="3"/><path d="m57 127-16 32h32m48-32 17 32h-32" stroke="#c3a2ce" stroke-width="2"/></svg>';

function installStyles() {
  const href = new URL('./fate-effects.css', import.meta.url).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) return;
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.dataset.fateEffects = '';
  stylesheet.href = href; document.head.append(stylesheet);
}

/** The game outcome is already committed. This stage only presents its dice and pecks. */
export function createFateEffects({ root, items, getLanguage = () => 'ru', getQuick = () => false, reducedMotion = false }) {
  installStyles();
  const itemById = new Map(items.map(item => [item.id, item]));
  const layer = document.createElement('div'); layer.className = 'fate-effects-layer'; layer.hidden = true; root.append(layer);
  let destroyed = false; const timers = new Map();
  let confirmResolve = null;
  const wait = ms => new Promise(resolve => { const id = setTimeout(() => { timers.delete(id); resolve(); }, ms); timers.set(id, resolve); });
  const ru = () => getLanguage() !== 'en';
  const preventEarlyKeys=event=>{if(!layer.hidden&&layer.dataset.kind==='chicken'&&layer.dataset.state==='rolling'&&['Enter',' ','Escape','Tab'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();}};
  document.addEventListener('keydown',preventEarlyKeys,true);
  function targetsHTML(event) {
    const build = event.before?.build || event.before || {};
    const targets = event.removedEntries || [];
    return targets.map((entry, index) => {
      const item = itemById.get(entry.itemId);
      // Removed-item journal entries are visibility snapshots, never re-opened by a later reveal.
      const sealed = entry.sealed === true || isBuildEntrySealed(build, entry, items);
      const name = sealed ? ru() ? 'Закрытая покупка' : 'Sealed purchase' : localizedItemName(item, ru() ? 'ru' : 'en');
      return `<span class="fate-peck-target${sealed ? ' is-sealed' : ''}" data-peck-index="${index}" title="${escape(name)}">${sealed ? SEALED_ITEM_SVG : item?.icon ? `<img src="${escape(assetURL(item.icon))}" alt="">` : '<b>◇</b>'}<small>${escape(name)}</small><i aria-hidden="true">×</i><span class="fate-target-feathers" aria-hidden="true">${Array.from({length:8},()=>'<i></i>').join('')}</span></span>`;
    }).join('');
  }
  async function play(event, { onSound = () => {}, onConfirm = async () => true } = {}) {
    if (destroyed || !event) return;
    const chicken = event.type === 'chicken';
    const king = event.type === 'hidden-king' || event.type === 'king-contract';
    const mother = event.type === 'archmother' || event.type === 'archmother-offer';
    const royalReveal=event.type==='royal-reveal';
    if (!chicken && !king && !mother && !royalReveal) return;
    layer.hidden = false; layer.dataset.kind = event.type; layer.dataset.phase = 'appear'; layer.dataset.reducedMotion = String(reducedMotion); layer.dataset.state = chicken ? 'rolling' : 'presenting';
    if (chicken) {
      const die = Math.max(1, Math.min(12, Number(event.die) || 1));
      layer.innerHTML = `<section class="fate-cinematic fate-chicken-cinematic" role="dialog" aria-modal="true" aria-labelledby="fate-chicken-title"><span class="fate-cinematic-kicker">DEADLOCK / ${ru() ? 'НЕЗВАНЫЙ ГОСТЬ' : 'UNINVITED GUEST'}</span><h2 id="fate-chicken-title">${ru() ? 'Курица судьбы' : 'The chicken of fate'}</h2><div class="fate-chicken-stage">${CHICKEN_SVG}<div class="fate-die" data-state="rolling">${DIE_SVG}<b>?</b><small>D12</small></div></div><div class="fate-die-rules">${[[1,6,'1'],[7,9,'2'],[10,11,'3'],[12,12,'12']].map(([from,to,count]) => `<span data-die-range="${from}-${to}"><b>${from === to ? from : `${from}–${to}`}</b><small>${count === '12' ? ru() ? 'весь билд' : 'whole build' : `${count} ${ru() ? 'предм.' : 'items'}`}</small></span>`).join('')}</div><p class="fate-event-result" aria-live="polite">${ru() ? 'Бросок решает, сколько предметов она выклюет.' : 'The die decides how many items she pecks away.'}</p><div class="fate-peck-targets${event.fullReroll ? ' is-whole-build' : ''}" hidden aria-hidden="true">${targetsHTML(event)}</div><button id="fate-chicken-continue" type="button" disabled hidden></button><p class="fate-confirm-status" aria-live="polite"></p></section>`;
      layer.querySelectorAll('.fate-target-feathers').forEach(burst=>burst.querySelectorAll('i').forEach((feather,index)=>feather.style.setProperty('--feather-i',String(index))));
      const number = layer.querySelector('.fate-die>b');
      onSound('chicken'); await wait(180); layer.dataset.phase = 'hold';
      const resume = event.resuming || event.journalReplay;
      const duration = resume ? 180 : reducedMotion ? 3000 : getQuick() ? 4600 : 8200;
      const steps = resume || reducedMotion ? 1 : getQuick() ? 27 : 42;
      const delays = Array.from({length:steps},(_,index)=>55 + 270 * (index / Math.max(1,steps-1)) ** 3);
      const delayTotal = delays.reduce((sum,value)=>sum+value,0);
      let previousFace = 0;
      for (let index = 0; index < steps && !destroyed; index++) {
        if (!reducedMotion && !resume) {
          const face = 1 + ((previousFace + Math.floor(randomUnitInterval() * 11)) % 12);
          previousFace = face; number.textContent = String(face); onSound('dice-tick');
        }
        await wait(duration * delays[index] / delayTotal);
      }
      if (destroyed) return;
      number.textContent = String(die); layer.querySelector('.fate-die').dataset.state = 'landed'; layer.querySelector('.fate-die').dataset.result = String(die);
      layer.querySelector('.fate-peck-targets').hidden = false; layer.querySelector('.fate-peck-targets').removeAttribute('aria-hidden');
      layer.querySelectorAll('[data-die-range]').forEach(range=>{const[from,to]=range.dataset.dieRange.split('-').map(Number);range.classList.toggle('is-selected',die>=from&&die<=to);});
      const removedCount = event.removedEntries?.length || event.removedItemIds?.length || 1;
      layer.querySelector('.fate-event-result').textContent = event.fullReroll
        ? ru() ? 'Двенадцать. Всё заново: новый инвентарь будет заперт.' : 'Twelve. Start over: the new inventory will be locked.'
        : ru() ? `Потеря предметов: ${removedCount}. Курица забирает последние покупки.` : `Items lost: ${removedCount}. The chicken takes the most recent purchases.`;
      onSound('dice-land');
      const continueButton = layer.querySelector('#fate-chicken-continue');
      continueButton.textContent = event.fullReroll ? ru() ? 'Принять судьбу · пересобрать весь билд' : 'Accept fate · rebuild the inventory' : ru() ? 'Продолжить · отпустить предметы' : 'Continue · let the items go';
      continueButton.hidden = false; continueButton.disabled = false; layer.dataset.state = 'ready';
      continueButton.focus({preventScroll:true});
      await new Promise(resolve=>{
        confirmResolve=resolve;
        const confirm = async()=>{
          if (destroyed || layer.dataset.state !== 'ready') return;
          layer.dataset.state='confirming'; continueButton.disabled=true;
          try {
            const saved = await onConfirm(event);
            if (saved === false) throw new Error('confirmation-not-saved');
          } catch {
            if (destroyed) return;
            layer.dataset.state='ready'; continueButton.disabled=false;
            layer.querySelector('.fate-confirm-status').textContent=ru()?'Не удалось сохранить. Нажми ещё раз.':'Could not save. Press again to retry.';
            continueButton.focus({preventScroll:true}); return;
          }
          layer.removeEventListener('click',click); document.removeEventListener('keydown',key,true); confirmResolve=null; resolve();
        };
        const click=e=>{if(e.target.closest('#fate-chicken-continue'))confirm();};
        const key=e=>{
          if(layer.hidden)return;
          if(['Enter',' ','Escape'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();if(e.key!=='Escape'&&!e.repeat&&layer.dataset.state==='ready')confirm();}
          if(e.key==='Tab'){e.preventDefault();continueButton.focus({preventScroll:true});}
        };
        layer.addEventListener('click',click); document.addEventListener('keydown',key,true);
        const oldResolve=confirmResolve; confirmResolve=()=>{layer.removeEventListener('click',click);document.removeEventListener('keydown',key,true);oldResolve();};
      });
      if(destroyed)return;
      layer.dataset.state='pecking'; continueButton.disabled=true; if(event.fullReroll)onSound('wipe');
      const targets = [...layer.querySelectorAll('.fate-peck-target')];
      for (const target of targets) {
        if (destroyed) return;
        layer.querySelector('.fate-chicken')?.classList.remove('is-pecking');
        void layer.offsetWidth;
        layer.querySelector('.fate-chicken')?.classList.add('is-pecking');
        target.classList.add('is-pecked'); target.querySelector('.fate-target-feathers')?.classList.add('is-scattered'); onSound('peck'); onSound('feather');
        await wait(reducedMotion ? 100 : event.fullReroll ? 110 : 340);
      }
      await wait(reducedMotion ? 200 : 1000);
    } else if(royalReveal) {
      const item=itemById.get(event.entry?.itemId),fake=event.entry?.kingImpostor===true;
      layer.dataset.fake=String(fake);layer.dataset.state='revealing';
      layer.innerHTML=`<section class="fate-cinematic fate-royal-reveal" role="status"><div class="fate-royal-breaking-seal" aria-hidden="true">${FATE_PRESENTATION.king.svg}<i></i><i></i><i></i><i></i></div><span class="fate-royal-reveal-item">${item?.icon?`<img src="${escape(assetURL(item.icon))}" alt="">`:''}</span><h2>${fake?ru()?'Самозванец':'The impostor':ru()?'Печать сломана':'The seal is broken'}</h2><p>${escape(localizedItemName(item,ru()?'ru':'en'))}</p>${fake?`<span class="fate-counterfeit-stamp">${ru()?'ПОДДЕЛКА · T1':'COUNTERFEIT · T1'}</span>`:''}</section>`;
      onSound(fake?'impostor':'royal-reveal');await wait(reducedMotion?120:200);layer.dataset.phase='hold';await wait(reducedMotion?780:1000);
    } else {
      const deal=event.type==='king-contract';
      const dealCopies={exchange:ru()?['Королевский обмен','Цена уплачена. Закрытая награда занимает освободившееся место.']:['Royal exchange','The price is paid. A sealed reward takes its place.'],treasury:ru()?['Сокровищница открыта','Три покупки уходят Королю. Предмет T4 и связка приходят под его печатью.']:['The treasury opens','Three purchases go to the King. A T4 item and a pair arrive under his seal.'],impostor:ru()?['Самозванец среди даров','Три золотых свёртка. Два дара T3/T4 и одна подделка T1. Открывай по очереди.']:['An impostor among the gifts','Three golden parcels. Two T3/T4 gifts and one T1 fake. Open them in order.'],decree:ru()?['Королевский указ','На остаток этого билда Король меняет правила.']:['Royal decree','For the rest of this build the King changes the rules.']};
      const [dealTitle,dealHint]=dealCopies[event.mode]||['',''];
      layer.innerHTML = `<section class="fate-cinematic fate-patron-cinematic" role="status"><span class="fate-cinematic-kicker">DEADLOCK / ${ru() ? 'ВМЕШАТЕЛЬСТВО' : 'INTERVENTION'}</span><div class="fate-patron-mark">${FATE_PRESENTATION[king?'king':'archmother'].svg}</div><h2>${king ? ru() ? 'Тайный король' : 'The Hidden King' : ru() ? 'Дар Архиматери' : 'The Archmother’s gift'}</h2><p>${king ? ru() ? 'Будущие покупки закрыты. Открывай их строго по одной, в порядке маршрута.' : 'Future purchases are sealed. Reveal them one at a time, in purchase order.' : ru() ? 'Один из трёх даров становится частью твоего контракта.' : 'One of three gifts becomes part of your contract.'}</p><span class="fate-patron-seal" aria-hidden="true">${king ? '◇' : '✦'}</span></section>`;
      if(king&&event.type==='hidden-king')layer.querySelector('p').textContent=ru()?'Он предлагает четыре сделки. Выбери свою цену.':'He offers four deals. Choose your price.';
      if(deal){
        layer.dataset.kingMode=event.mode;layer.querySelector('h2').textContent=dealTitle;layer.querySelector('p').textContent=dealHint;
        if(event.sacrificedEntries?.length){layer.querySelector('section').insertAdjacentHTML('beforeend',`<div class="fate-royal-sacrifices">${targetsHTML({...event,removedEntries:event.sacrificedEntries})}</div>`);}
        if(event.mode==='decree'){
          const edict=event.edict||event.after?.build?.fate?.kingEdict;
          const labels=ru()?{spirit:'Вес спирита ×6',vitality:'Вес ХП ×6','no-t1':'Никаких T1'}:{spirit:'Spirit weight ×6',vitality:'Vitality weight ×6','no-t1':'No T1 items'};
          layer.querySelector('section').insertAdjacentHTML('beforeend',`<div class="fate-royal-edicts">${['spirit','vitality','no-t1'].map(key=>`<span data-royal-edict="${key}">${labels[key]}</span>`).join('')}</div>`);
          layer.dataset.edict=edict||'';
        }
      }
      onSound(king ? 'king' : 'archmother'); await wait(280); layer.dataset.phase = 'hold';
      if(deal&&event.mode==='decree'){
        const cards=[...layer.querySelectorAll('[data-royal-edict]')];
        if(!reducedMotion)for(let index=0;index<12&&!destroyed;index++){
          cards.forEach((card,cardIndex)=>card.classList.toggle('is-cycling',cardIndex===index%cards.length));onSound('dice-tick');await wait(80+index*11);
        }
        cards.forEach(card=>card.classList.remove('is-cycling'));
        const edict=layer.dataset.edict;layer.querySelector(`[data-royal-edict="${edict}"]`)?.classList.add('is-selected');onSound('edict');await wait(reducedMotion?1800:1300);
      }else await wait(king ? 2450 : 1900);
    }
    if (destroyed) return;
    layer.dataset.phase = 'disappear'; await wait(260); layer.hidden = true; layer.innerHTML = '';
  }
  return { play, destroy() { destroyed = true; document.removeEventListener('keydown',preventEarlyKeys,true);confirmResolve?.();confirmResolve=null; for (const [id, resolve] of timers) { clearTimeout(id); resolve(); } timers.clear(); layer.remove(); } };
}
