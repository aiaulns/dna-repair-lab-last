'use strict';
const $ = id => document.getElementById(id);
const $$ = query => [...document.querySelectorAll(query)];

// Navigation ------------------------------------------------------------
function showPage(name) {
  $$('.page').forEach(p => p.classList.toggle('active', p.id === name));
  $$('.nav button').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  window.scrollTo({top:0,behavior:'instant'});
  if(name === 'molecules') { initMolecularView(); setTimeout(() => { if(viewer) viewer.resize(); }, 150); }
  if(name === 'simulation') renderBER();
}
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.goto)));

// Continuous stylized DNA drawing: illustrative fallback, not PDB data --
function makeHelix(canvasId) {
  const canvas = $(canvasId);
  const ctx = canvas.getContext('2d');
  let width=0,height=0,t=0;
  const maxRatio=2;
  function draw() {
    if(!canvas.isConnected) return;
    const rect = canvas.getBoundingClientRect();
    if(Math.abs(rect.width-width)>1 || Math.abs(rect.height-height)>1) {
      width=rect.width; height=rect.height;
      const ratio=Math.min(window.devicePixelRatio||1,maxRatio);
      canvas.width=Math.max(1,Math.round(width*ratio)); canvas.height=Math.max(1,Math.round(height*ratio));
      ctx.setTransform(ratio,0,0,ratio,0,0);
    }
    ctx.clearRect(0,0,width,height);
    const count=34,center=width/2,scale=Math.min(width/620,height/460),rad=110*scale;
    const top=height*.11,travel=height*.77;
    const pts=[];
    for(let i=0;i<count;i++) {
      const y=top+(i/(count-1))*travel;
      const a=(i*.52)+(t*.013);
      const z=Math.sin(a),x=Math.cos(a)*rad;
      pts.push({y,a,z,x});
    }
    for(let i=0;i<count-1;i++) {
      const p=pts[i],q=pts[i+1];
      ctx.strokeStyle=`rgba(126,202,226,${.2+(.5+p.z*.25)*.38})`;ctx.lineWidth=2.5*scale;
      ctx.beginPath();ctx.moveTo(center+p.x,p.y);ctx.lineTo(center-p.x,p.y);ctx.stroke();
    }
    for(let strand=0;strand<2;strand++){
      const sign=strand===0?1:-1;
      for(let i=0;i<count-1;i++){
        const p=pts[i],q=pts[i+1],depth=(sign*p.z+1)/2;
        ctx.strokeStyle=strand===0?`rgba(83,235,225,${.3+.7*depth})`:`rgba(176,159,255,${.3+.7*depth})`;
        ctx.lineWidth=(3+depth*4)*scale;ctx.lineCap='round';ctx.shadowBlur=10*scale;
        ctx.shadowColor=strand===0?'#47e6d9':'#9683ff';
        ctx.beginPath();ctx.moveTo(center+sign*p.x,p.y);ctx.lineTo(center+sign*q.x,q.y);ctx.stroke();ctx.shadowBlur=0;
      }
    }
    for(let i=0;i<count;i++) {
      const p=pts[i];
      for(let strand=0;strand<2;strand++) {
        const sign=strand===0?1:-1,depth=(sign*p.z+1)/2;
        ctx.beginPath();ctx.fillStyle=strand===0?'#8cfff0':'#d3c1ff';ctx.globalAlpha=.4+depth*.6;
        ctx.arc(center+sign*p.x,p.y,(2.5+depth*2.3)*scale,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      }
    }
    t+=1;
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
makeHelix('heroCanvas');makeHelix('fallbackCanvas');

// Real 3D rendering. Each entry links to a verified experimental PDB. ---
const proteins = [
 {id:'1SSP',name:'Урацил-ДНК-гликозилаза',short:'UNG · поиск урацила',desc:'Человеческая урацил-ДНК-гликозилаза в комплексе с ДНК. Важна для начала BER: узнаёт урацил и удаляет его, образуя AP-сайт. В этой структуре присутствует ДНК-комплекс.',method:'Рентгеноструктурный анализ',res:'1.90 Å',color:'#54e8db'},
 {id:'5DFI',name:'AP-эндонуклеаза 1',short:'APE1 · надрез AP-сайта',desc:'Человеческая APE1 в комплексе с модельным ДНК-субстратом. Надрезает сахарофосфатный остов рядом с AP-сайтом, подготавливая участок к дальнейшей обработке.',method:'Рентгеноструктурный анализ',res:'1.63 Å',color:'#86b3ff'},
 {id:'2FMS',name:'ДНК-полимераза β',short:'POL β · заполнение пробела',desc:'Человеческая полимераза β с ДНК, содержащей пробел, и аналогом входящего нуклеотида. Полимераза β восполняет короткий пробел при варианте BER и обладает dRP-лиазной активностью.',method:'Рентгеноструктурный анализ',res:'2.00 Å',color:'#c0a1ff'},
 {id:'3L2P',name:'ДНК-лигаза III',short:'LIG3 · соединение цепи',desc:'Структурный комплекс человеческой ДНК-лигазы III с ДНК. Лигаза восстанавливает фосфодиэфирную связь в цепи; показан один из экспериментально изученных комплексов.',method:'Рентгеноструктурный анализ',res:'3.00 Å',color:'#f6a2c1'}
];
let currentProtein=0,viewer=null,viewerStarted=false,viewStyle='ribbon',spinning=true;
let activeLoad=0,localData=null,libraryLoadPromise=null,currentModelText=null;
const proteinList=$('enzymeList');
function renderProteinList() {
  proteinList.innerHTML = proteins.map((p,i)=>`<button class="enzyme-item ${currentProtein===i?'active':''}" data-protein="${i}"><span class="enzyme-num">0${i+1}</span><span><span class="enzyme-name">${p.name}</span><span class="enzyme-sub">${p.short}</span></span><span class="id">${p.id}</span></button>`).join('');
  $$('[data-protein]').forEach(b=>b.addEventListener('click',()=>selectProtein(+b.dataset.protein)));
}
function updateProteinDescription() {
  const p=proteins[currentProtein];
  $('enzymeTitle').textContent=p.name;
  $('enzymeText').textContent=p.desc;
  $('pdbCode').textContent=p.id;
  $('enzymeRes').textContent=p.res;
  $('enzymeMethod').textContent=p.method;
  $('pdbLink').href='https://www.rcsb.org/structure/'+p.id;
  renderProteinList();
}
function showMoleculeMessage(message, type='wait') {
  $('viewerMessage').textContent=message;
  $('viewerMessage').classList.remove('hidden');
  $('viewerBadge').textContent=type==='error'?'нет подключения':type==='ok'?'PDB загружена':'загрузка…';
}
function resolve3DLibrary() {
  if(window.$3Dmol) return Promise.resolve();
  if(libraryLoadPromise) return libraryLoadPromise;
  libraryLoadPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://3Dmol.org/build/3Dmol-min.js';
    script.async=true;
    const t=setTimeout(()=>{script.remove();reject(Error('Истекло время загрузки 3Dmol.js'));},16000);
    script.onload=()=>{clearTimeout(t);window.$3Dmol?resolve():reject(Error('Библиотека не инициализировалась'));};
    script.onerror=()=>{clearTimeout(t);reject(Error('Не удалось скачать библиотеку 3Dmol.js'));};
    document.head.appendChild(script);
  }).catch(err=>{libraryLoadPromise=null;throw err});
  return libraryLoadPromise;
}
async function initMolecularView() {
  if(!viewerStarted) {viewerStarted=true;await loadMolecule();}
}
async function selectProtein(i) {
  currentProtein=i;localData=null;currentModelText=null;
  updateProteinDescription();
  await loadMolecule();
}
async function loadMolecule() {
  const serial=++activeLoad;
  const p=proteins[currentProtein];
  showMoleculeMessage('Получаем экспериментальную структуру '+p.id+' из Protein Data Bank…');
  try {
    await resolve3DLibrary();
    if(serial!==activeLoad)return;
    if(!viewer) viewer=$3Dmol.createViewer($('molviewer'),{backgroundColor:'#081722',antialias:true});
    let pdb=localData;
    if(!pdb) {
      const url='https://files.rcsb.org/download/'+p.id+'.pdb';
      const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),18000);
      try {
        const response=await fetch(url,{signal:ctrl.signal});
        if(!response.ok)throw Error('HTTP '+response.status);
        pdb=await response.text();
      } finally {clearTimeout(timeout);}
    }
    if(serial!==activeLoad)return;
    if(!pdb.includes('ATOM')) throw Error('Некорректный файл PDB: нет атомных координат');
    currentModelText=pdb;
    applyViewStyle();
    $('molviewer').style.display='block';
    $('viewerMessage').classList.add('hidden');
    $('viewerBadge').textContent=localData?'локальный PDB':'PDB загружена';
  } catch(err) {
    if(serial!==activeLoad)return;
    console.warn('3D unavailable:',err);
    $('molviewer').style.display='none';
    showMoleculeMessage('3D не загрузилось: проверь интернет и нажми «Повторить загрузку». Сейчас показана учебная спираль, не форма фермента.', 'error');
  }
}
function applyViewStyle() {
  if(!viewer || !currentModelText) return;
  const p=proteins[currentProtein];
  viewer.clear();
  viewer.addModel(currentModelText,'pdb');
  if(viewStyle==='surface') {
    viewer.setStyle({}, {cartoon:{color:p.color,opacity:.15}});
    viewer.addSurface($3Dmol.SurfaceType.VDW,{opacity:.87,color:p.color},{});
  } else if(viewStyle==='sticks') {
    viewer.setStyle({}, {stick:{radius:.13,colorscheme:'Jmol'}});
  } else {
    viewer.setStyle({},{cartoon:{color:p.color}});
    ['DA','DT','DG','DC','DU','A','U','G','C','T'].forEach(resn=>{
      viewer.addStyle({resn},{stick:{radius:.17,colorscheme:'Jmol'}});
    });
  }
  viewer.zoomTo();viewer.render();viewer.resize();
  const controls={ribbon:'viewRibbon',surface:'viewSurface',sticks:'viewSticks'};
  Object.entries(controls).forEach(([name,id])=>$(id).classList.toggle('primary',viewStyle===name));
}
$('viewRibbon').addEventListener('click',()=>{viewStyle='ribbon';applyViewStyle()});
$('viewSurface').addEventListener('click',()=>{viewStyle='surface';applyViewStyle()});
$('viewSticks').addEventListener('click',()=>{viewStyle='sticks';applyViewStyle()});
$('viewReset').addEventListener('click',()=>{if(viewer){viewer.zoomTo();viewer.render();}});
$('viewRotate').addEventListener('click',()=>{spinning=!spinning;$('viewRotate').textContent='⟳ Автовращение: '+(spinning?'вкл':'выкл')});
$('retry3d').addEventListener('click',()=>{libraryLoadPromise=null;loadMolecule()});
$('localPDB').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>18_000_000){showMoleculeMessage('Файл слишком большой (лимит 18 МБ).','error');return}
  localData=await file.text();
  await loadMolecule();
});
setInterval(()=>{if(viewer && spinning && $('molecules').classList.contains('active') && currentModelText){try{viewer.rotate(.35,'y');viewer.render()}catch(err){console.warn(err)}}},60);
updateProteinDescription();

// BER educational schematic --------------------------------------------
const berSteps=[
 {title:'Обнаружено повреждение',brief:'Урацил напротив гуанина',description:'В результате дезаминирования цитозина в ДНК может появиться урацил. В данной модели U находится напротив G. Если повреждение не исправить, при следующей репликации может закрепиться изменение последовательности.',why:'Исходная правильная пара была C–G. Неповреждённая цепь с G позже подскажет, какой нуклеотид восстановить.',enzyme:'',phase:'Повреждение'},
 {title:'Удаление урацила',brief:'Работает ДНК-гликозилаза',description:'Урацил-ДНК-гликозилаза распознаёт урацил в ДНК и разрывает связь между основанием и дезоксирибозой. Урацил удаляется, но сахарофосфатный остов пока остаётся.',why:'После удаления основания образуется AP-сайт — место без азотистого основания. Самостоятельно заполнять его полимераза ещё не может.',enzyme:'ДНК-ГЛИКОЗИЛАЗА · UNG',phase:'AP-сайт'},
 {title:'Разрез цепи',brief:'APE1 узнаёт AP-сайт',description:'AP-эндонуклеаза APE1 разрезает фосфодиэфирную связь рядом с AP-сайтом. Образуется одноцепочечный разрыв, который подготавливает ДНК к удалению остатка сахаро-фосфатной группы.',why:'Эта стадия превращает повреждённый участок в субстрат для дальнейшей обработки.',enzyme:'AP-ЭНДОНУКЛЕАЗА · APE1',phase:'Надрез'},
 {title:'Подготовка пробела',brief:'Удаление 5′-dRP',description:'ДНК-полимераза β обладает 5′-dRP-лиазной активностью и удаляет оставшийся дезоксирибозофосфатный фрагмент. В цепи остаётся короткий пробел.',why:'При короткозаплаточном BER должен быть удалён не только повреждённый азотистый фрагмент, но и остаток повреждённого нуклеотида.',enzyme:'ДНК-ПОЛИМЕРАЗА β',phase:'Пробел'},
 {title:'Синтез нового нуклеотида',brief:'Pol β вставляет C',description:'Полимераза β синтезирует недостающий нуклеотид по неповреждённой матрице. Напротив G устанавливается C, образуя нормальную пару C–G.',why:'Фосфодиэфирная связь на одном конце ещё отсутствует: после синтеза сохраняется разрыв (nick).',enzyme:'ДНК-ПОЛИМЕРАЗА β',phase:'Новый C'},
 {title:'Восстановление завершено',brief:'Лигаза закрывает разрыв',description:'Комплекс с ДНК-лигазой III (в клетках человека часто вместе с XRCC1) может завершить короткозаплаточный BER, соединяя концы ДНК. Целостность цепи восстановлена.',why:'Схема показывает один распространённый вариант BER, а не единственно возможный путь. Молекулярные движения намеренно упрощены.',enzyme:'ДНК-ЛИГАЗА III · LIG3',phase:'Восстановлено'}
];
const basesTop=['A','T','G','C','A','T','U','G','C','A','T','G','C'];
const basesBottom=['T','A','C','G','T','A','G','C','G','T','A','C','G'];
let berIndex=0,berTimer=null;
function makeDNAPairs() {
  $('dnaPairs').innerHTML=basesTop.map((base,i)=>{
    const x=158+i*50,damaged=i===6;
    const top=damaged?(berIndex===0?'U':berIndex<4?'': 'C'):base;
    const bg=damaged?(berIndex>=4?'#135b4c':'#a0394f'):'#15485b';
    const gap=damaged&&(berIndex>=2&&berIndex<=3);
    const topRect=top?`<rect x="${x-17}" y="159" width="34" height="42" rx="8" fill="${bg}" stroke="${damaged?'#ff98a4':'#317d94'}"/><text x="${x}" y="186" text-anchor="middle" fill="${damaged?'#fff5d6':'#bafaff'}" font-size="20" font-weight="750">${top}</text>`:`<rect x="${x-17}" y="159" width="34" height="42" rx="8" fill="#10212b" stroke="#ffcb8a" stroke-dasharray="5 4"/><text x="${x}" y="186" text-anchor="middle" fill="#ffcb8a" font-size="14">AP</text>`;
    return `<g><line x1="${x}" y1="197" x2="${x}" y2="239" stroke="${damaged?'#e9b588':'#426e83'}" stroke-width="3" opacity=".65"/>${topRect}<rect x="${x-17}" y="240" width="34" height="42" rx="8" fill="#2a2857" stroke="#6f62ab"/><text x="${x}" y="267" text-anchor="middle" font-size="20" fill="#d9d0ff" font-weight="750">${basesBottom[i]}</text></g>`;
  }).join('');
}
function renderBER() {
  const s=berSteps[berIndex];
  $('phaseCounter').textContent=String(berIndex+1).padStart(2,'0')+' / 06';
  $('currentStepTitle').textContent=s.title;
  $('currentStepText').textContent=s.description;
  $('currentStepWhy').textContent=s.why;
  $('stepCards').innerHTML=berSteps.map((st,i)=>`<button class="step-card ${i===berIndex?'active':i<berIndex?'done':''}" data-ber="${i}"><span class="n">${String(i+1).padStart(2,'0')}</span><span><strong>${st.title}</strong><small>${st.brief}</small></span></button>`).join('');
  $$('[data-ber]').forEach(b=>b.addEventListener('click',()=>{stopBER();berIndex=+b.dataset.ber;renderBER()}));
  $('simProgress').style.width=100*berIndex/(berSteps.length-1)+'%';
  makeDNAPairs();
  $('repairLabel').textContent=s.phase;
  $('repairLabel').setAttribute('fill',berIndex===5?'#86f3bb':berIndex>=4?'#c0efc5':'#ff9baf');
  $('dnaLesion').style.opacity=berIndex<2?'1':'0';
  $('dnaGap').style.opacity=(berIndex===2||berIndex===3)?'1':'0';
  $('spark').style.opacity=berIndex===5?'1':'0';
  $('enzymeTag').style.opacity=berIndex===0?'0':'1';
  $('enzymeTagText').textContent=s.enzyme;
  const sprite=$('enzymeSprite');
  const x=berIndex===0?-100:berIndex===1?450:berIndex===2?475:berIndex===3?500:berIndex===4?445:berIndex===5?540:0;
  const y=berIndex===0?70:berIndex===2?116:berIndex===3?128:berIndex===5?135:107;
  sprite.style.opacity=berIndex===0?'0':'1';
  sprite.style.transform=`translate(${x}px,${y}px)`;
  $('prevStep').disabled=berIndex===0;
  $('nextStep').disabled=berIndex===berSteps.length-1;
}
function stopBER() {if(berTimer){clearInterval(berTimer);berTimer=null}$('playSteps').textContent='▶ Воспроизвести'}
function moveBER(direction) {berIndex=Math.max(0,Math.min(berSteps.length-1,berIndex+direction));renderBER();if(berIndex===berSteps.length-1)stopBER()}
$('prevStep').addEventListener('click',()=>{stopBER();moveBER(-1)});
$('nextStep').addEventListener('click',()=>{stopBER();moveBER(1)});
$('resetSteps').addEventListener('click',()=>{stopBER();berIndex=0;renderBER()});
$('playSteps').addEventListener('click',()=>{
  if(berTimer){stopBER();return;}
  if(berIndex===berSteps.length-1){berIndex=0;renderBER();}
  $('playSteps').textContent='Ⅱ Пауза';
  berTimer=setInterval(()=>moveBER(1),Number($('stepSpeed').value));
});
$('stepSpeed').addEventListener('change',()=>{if(berTimer){stopBER();$('playSteps').click()}});
for(let i=0;i<=18;i++)$('gridLines').insertAdjacentHTML('beforeend',`<line x1="${40+i*48}" y1="25" x2="${40+i*48}" y2="404" stroke="#3c7180" opacity=".08"/>`);
renderBER();

// Interactive short-patch BER experiment --------------------------------
const labActions=[
 {id:'gly',label:'Применить ДНК-гликозилазу',description:'Урацил распознан и удалён. Образовался AP-сайт.'},
 {id:'ape',label:'Внести APE1',description:'APE1 сделала надрез рядом с AP-сайтом.'},
 {id:'drp',label:'Удалить 5′-dRP',description:'dRP-лиазная функция Pol β удалила сахарофосфатный остаток.'},
 {id:'pol',label:'Добавить нуклеотид с Pol β',description:'Неповреждённый G определил включение C.'},
 {id:'lig',label:'Задействовать ДНК-лигазу',description:'Разрыв закрыт: повреждённый участок восстановлен.'}
];
const extraActions=[
 {id:'ner',label:'Вырезать длинный фрагмент NER'},
 {id:'rna',label:'Запустить РНК-полимеразу'},
 {id:'mut',label:'Заменить G на A'},
 {id:'join',label:'Сразу соединить цепь'}
];
let labIndex=0,labErrors=0,labHistory=[];
function renderPractice() {
  const all=[labActions[3],extraActions[0],labActions[0],extraActions[1],labActions[4],extraActions[2],labActions[1],extraActions[3],labActions[2]];
  $('actionOptions').innerHTML=all.map(action=>`<button class="action" data-action-id="${action.id}" ${labIndex===5?'disabled':''}>${action.label}</button>`).join('');
  $$('[data-action-id]').forEach(b=>b.addEventListener('click',()=>chooseLabAction(b.dataset.actionId)));
  $('practiceCount').textContent=labIndex+' / 5';
  $('practiceProgress').style.width=(labIndex/5*100)+'%';
  const topSequence=labIndex===0?'<em>U</em>':labIndex<4?'<em>□</em>':'<strong class="fixed">C</strong>';
  $('sequenceTop').innerHTML=`5′ A T G ${topSequence} A C T G 3′`;
  $('journalItems').innerHTML=labActions.map((action,i)=>`<div class="journal-item ${i<labIndex?'completed':''}">${i<labIndex?'✓ ':String(i+1).padStart(2,'0')+' · '}${action.label}</div>`).join('');
}
function chooseLabAction(id) {
  if(labIndex>=labActions.length)return;
  if(id===labActions[labIndex].id) {
    const step=labActions[labIndex];labHistory.push(step.description);labIndex++;
    $('practiceFeedback').className='practice-feedback success';
    $('practiceFeedback').textContent=labIndex===5?'Отлично! Модель BER завершена. Ты восстановил(а) пару C–G.':step.description+' Следующий шаг?';
  } else {
    labErrors++;
    $('practiceFeedback').className='practice-feedback error';
    const cues=['Сначала нужно распознать и удалить урацил.','Основание уже удалено. Что надрезает AP-сайт?','Надрез сделан. Нужно убрать остаток дезоксирибозофосфата.','Пробел готов. Какой фермент достроит C?','Новый C установлен. Теперь нужно соединить остов ДНК.'];
    $('practiceFeedback').textContent='Не подходит для данного этапа. Подсказка: '+cues[labIndex];
  }
  renderPractice();
}
function resetLab() {
  labIndex=0;labErrors=0;labHistory=[];
  $('practiceFeedback').className='practice-feedback';
  $('practiceFeedback').textContent='Начни с удаления повреждённого основания.';
  renderPractice();
}
$('practiceReset').addEventListener('click',resetLab);
$('downloadJournal').addEventListener('click',()=>{
  const text=[
    'DNA REPAIR LAB / ЖУРНАЛ ВИРТУАЛЬНОГО ЭКСПЕРИМЕНТА',
    'Модель: короткозаплаточная эксцизионная репарация оснований (BER)',
    'Исходное повреждение: U напротив G (дезаминирование C)',
    'Пройдено стадий: '+labIndex+'/5',
    'Ошибочных попыток: '+labErrors,'','ХОД РАБОТЫ:',
    ...labHistory.map((a,i)=>(i+1)+'. '+a),'',
    'РЕЗУЛЬТАТ: '+(labIndex===5?'модельный участок восстановлен: C–G':'эксперимент не завершён'),
    'Вывод: последовательная работа специализированных ферментов необходима для устранения повреждённого основания и восстановления целостности ДНК.'
  ].join('\n');
  const href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=href;a.download='DNA-Repair-Lab-journal.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(href),2000);
});
renderPractice();

// Knowledge check -------------------------------------------------------
const questions=[
 {q:'Что возникает после того, как ДНК-гликозилаза удалила урацил?',a:['AP-сайт (участок без основания)','Двойной разрыв ДНК','Новая РНК'],ok:0,why:'Разрыв N-гликозидной связи удаляет основание, оставляя AP-сайт.'},
 {q:'Какая пара должна быть восстановлена на месте U–G в нашем примере?',a:['A–T','C–G','U–A'],ok:1,why:'Урацил образовался после дезаминирования цитозина. Неповреждённый G служит матрицей для восстановления C.'},
 {q:'Какова роль APE1 в короткозаплаточном BER?',a:['Надрезать цепь возле AP-сайта','Соединить разрыв лигазой','Синтезировать белок'],ok:0,why:'APE1 — AP-эндонуклеаза, она надрезает сахарофосфатный остов около AP-сайта.'},
 {q:'Какая функция Pol β важна помимо включения нуклеотида?',a:['5′-dRP-лиазная активность','Раскручивание хроматина как единственная задача','Уничтожение рибосом'],ok:0,why:'Полимераза β может удалять 5′-дезоксирибозофосфатный остаток при BER.'},
 {q:'Что завершает восстановление сахарофосфатного остова?',a:['ДНК-лигаза','ДНК-гликозилаза','Геликаза транскрипции'],ok:0,why:'Лигаза образует недостающую фосфодиэфирную связь.'},
 {q:'Какой путь чаще направлен на объёмные УФ-повреждения?',a:['MMR','NER','Трансляция'],ok:1,why:'NER способен удалять фрагменты цепи, содержащие ряд объёмных фотопродуктов.'},
 {q:'Какие ошибки обычно устраняет MMR?',a:['Ошибки спаривания после репликации','Любые повреждения исключительно одним ферментом','Неправильно свёрнутые белки'],ok:0,why:'MMR распознаёт и исправляет ошибки спаривания и некоторые небольшие вставки/делеции.'},
 {q:'Что научно корректно сказать о 3D-моделях PDB?',a:['Это запись движения ферментов в реальном времени','Это структуры отдельных экспериментально изученных состояний','Это случайные компьютерные фигуры'],ok:1,why:'Кристаллографические структуры фиксируют пространственное строение образца; анимация реакции требует отдельного моделирования.'}
];
let questionIndex=0,quizPoints=0,answerChosen=false;
function renderQuiz() {
  if(questionIndex>=questions.length){
    $('questionNumber').textContent='ТЕСТ ЗАВЕРШЁН';
    $('questionText').textContent='Исследование знаний завершено';
    $('quizAnswers').innerHTML='';
    $('quizExplanation').textContent=`Твой результат: ${quizPoints} из ${questions.length}. `+(quizPoints>=7?'Превосходно!':quizPoints>=5?'Хорошо! Повтори сложные этапы.':'Вернись к разделам «Теория» и «Анимация BER».');
    $('quizResult').textContent='Итоговая оценка: '+Math.round(100*quizPoints/questions.length)+'% правильных ответов.';
    $('quizNext').disabled=true;
    $('quizProgress').style.width='100%';
    return;
  }
  const q=questions[questionIndex];answerChosen=false;
  $('questionNumber').textContent=`ВОПРОС ${String(questionIndex+1).padStart(2,'0')} / ${String(questions.length).padStart(2,'0')}`;
  $('questionText').textContent=q.q;
  $('quizAnswers').innerHTML=q.a.map((v,i)=>`<button class="quiz-answer" data-answer="${i}">${String.fromCharCode(65+i)}. ${v}</button>`).join('');
  $$('[data-answer]').forEach(b=>b.addEventListener('click',()=>answerQuiz(+b.dataset.answer)));
  $('quizExplanation').textContent='Выбери правильный вариант.';
  $('quizNext').disabled=true;
  $('quizNext').textContent=questionIndex===questions.length-1?'Завершить тест →':'Следующий вопрос →';
  $('quizProgress').style.width=100*questionIndex/questions.length+'%';
}
function answerQuiz(index) {
  if(answerChosen)return;
  answerChosen=true;const q=questions[questionIndex];const correct=index===q.ok;
  if(correct) quizPoints++;
  $$('[data-answer]').forEach(b=>{b.disabled=true;const i=+b.dataset.answer;if(i===q.ok)b.classList.add('good');else if(i===index)b.classList.add('bad')});
  $('quizScore').textContent=quizPoints+' баллов';
  $('quizCurrentPoints').innerHTML=String(quizPoints).padStart(2,'0')+'<span> / 08</span>';
  $('quizExplanation').textContent=(correct?'✓ Правильно. ':'✕ Неверно. ')+q.why;
  $('quizNext').disabled=false;
  $('quizProgress').style.width=100*(questionIndex+1)/questions.length+'%';
}
$('quizNext').addEventListener('click',()=>{questionIndex++;renderQuiz()});
$('quizRestart').addEventListener('click',()=>{
  questionIndex=0;quizPoints=0;
  $('quizScore').textContent='0 баллов';
  $('quizCurrentPoints').innerHTML='00<span> / 08</span>';
  $('quizResult').textContent='Результат появится после завершения теста.';
  renderQuiz();
});
renderQuiz();

// Photoreactivation demo ----------------------------------------------------
const photoStates=[
 {tag:'НОРМА',btn:'Облучить УФ →',title:'Нормальная ДНК',text:'Два соседних тимина лежат на цепи отдельно, спираль не искажена.'},
 {tag:'УФ-ПОВРЕЖДЕНИЕ',btn:'Включить синий свет →',title:'Тиминовый димер',text:'Под действием УФ-излучения соседние тимины сшиваются в циклобутановый димер. Спираль искажается, репликация и транскрипция нарушаются.'},
 {tag:'ФОТОЛИАЗА + СИНИЙ СВЕТ',btn:'↺ Сначала',title:'Фотореактивация',text:'Фотолиаза связывается с димером и за счёт энергии видимого света (синего и фиолетового спектра) расщепляет его. Матрица не нужна, остов цепи остаётся целым. У человека фотолиазы нет: УФ-повреждения устраняет NER.'}
];
let photoIndex=0;
function renderPhoto(){
  const s=photoStates[photoIndex],dimer=photoIndex===1,fixed=photoIndex===2;
  $('photoTag').textContent=s.tag;$('photoBtn').textContent=s.btn;$('photoTitle').textContent=s.title;$('photoText').textContent=s.text;
  $('photoT1').style.transform=dimer?'translateX(14px)':'translateX(0)';
  $('photoT2').style.transform=dimer?'translateX(-14px)':'translateX(0)';
  ['photoT1','photoT2'].forEach(id=>{const r=$(id).firstElementChild;r.setAttribute('fill',dimer?'#7a2f45':fixed?'#135b4c':'#15485b');r.setAttribute('stroke',dimer?'#ff98a4':fixed?'#73f8a8':'#317d94');});
  $('photoDimer').setAttribute('opacity',dimer?'1':'0');
  $('photoLight').setAttribute('opacity',fixed?'.22':'0');
}
$('photoBtn').addEventListener('click',()=>{photoIndex=(photoIndex+1)%photoStates.length;renderPhoto();});
renderPhoto();
