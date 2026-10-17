(() => {
 const $=id=>document.getElementById(id);
 function say(text){if(!("speechSynthesis" in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang="es-CO";window.speechSynthesis.speak(u)}
 document.addEventListener("DOMContentLoaded",()=>{$("voice-btn").addEventListener("click",()=>{
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){$("voice-status").textContent="Este navegador no ofrece dictado compatible. Falta integrar el reconocimiento local offline.";say("El dictado no está disponible en este navegador.");return}
  try{const rec=new SR();rec.lang="es-CO";rec.continuous=false;rec.interimResults=false;rec.maxAlternatives=3;$("voice-status").textContent="Escuchando… diga el texto para observaciones o seleccione primero un campo.";
   rec.onresult=e=>{const text=e.results[0][0].transcript.trim();const active=document.activeElement;const target=active&&/^(INPUT|TEXTAREA)$/.test(active.tagName)?active:$("record-form").elements.observaciones;target.value=(target.value?target.value+" ":"")+text;$("voice-status").textContent="Reconocido: "+text};
   rec.onerror=e=>$("voice-status").textContent="Error de dictado: "+e.error;rec.onend=()=>{if($("voice-status").textContent.startsWith("Escuchando"))$("voice-status").textContent="No se recibió una respuesta. Intente de nuevo."};rec.start();
  }catch(e){$("voice-status").textContent="No fue posible iniciar el dictado: "+e.message}
 })});window.FincaVoice={say};
})();
