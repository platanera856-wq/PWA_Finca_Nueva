(() => {
  'use strict';
  async function sendRecord(record) {
    if (!navigator.onLine) throw new Error('No hay internet. El registro continúa guardado en este teléfono.');
    const payload = {
      idCliente: record.idCliente || record.id,
      // La fecha/hora original del teléfono debe viajar con el registro offline.
      fechaCaptura: record.fechaCaptura || record.createdAt || null,
      empleado: String(record.empleado),
      labor: String(record.labor),
      caballon: String(record.caballon),
      horas: Number(record.horas),
      matas: Number(record.matas),
      observaciones: record.observaciones || '',
      insumos: Array.isArray(record.insumos) ? record.insumos : [],
      latitud: record.latitud,
      longitud: record.longitud
    };
    const response = await window.FincaAPI.call('guardarRegistro', payload, 45000);
    if (!response || response.exito !== true) throw new Error((response && response.mensaje) || 'Apps Script no confirmó el guardado.');
    record.syncStatus = 'synced'; record.serverId = response.idLabor || ''; record.syncedAt = new Date().toISOString();
    await window.FincaDB.save(record);
    return response;
  }
  async function run() {
    const status = document.getElementById('sync-status');
    if (!navigator.onLine) { status.textContent = 'Sin internet. Los registros pendientes permanecen en este teléfono.'; return false; }
    try {
      const records = await window.FincaDB.all();
      const pending = records.filter(r => r.syncStatus !== 'synced');
      if (!pending.length) { status.textContent = 'No hay registros pendientes. Todo está sincronizado.'; return true; }
      for (let i = 0; i < pending.length; i++) {
        status.textContent = `Enviando registro ${i + 1} de ${pending.length}…`;
        try { await sendRecord(pending[i]); }
        catch (err) { status.textContent = `El registro queda pendiente en el teléfono: ${err.message}`; return false; }
      }
      status.textContent = `Sincronización terminada: ${pending.length} registro(s) confirmado(s) por Apps Script.`; return true;
    } catch (e) { status.textContent = 'Error al sincronizar: ' + e.message; return false; }
  }
  window.FincaSync = { run, sendRecord };
})();
