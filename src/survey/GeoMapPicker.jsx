import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/*
  اختيار نقطة بالنقر على الخريطة (للاستبيانات).
  الخلفية صورة جوية عند توفر الإنترنت، وحدود المحافظات والنواحي من ملف المنصة
  المحفوظ على الجهاز، فتبقى الخريطة قابلة للاستخدام بلا إنترنت.
*/
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const SYRIA = L.latLngBounds([32.25, 35.55], [37.38, 42.45]);

export default function GeoMapPicker({ value, onPick }) {
  const box = useRef(null);
  const map = useRef(null);
  const pin = useRef(null);

  useEffect(() => {
    const m = L.map(box.current, { attributionControl: false, zoomControl: true, minZoom: 6, maxBounds: SYRIA.pad(0.4) });
    map.current = m;
    if (value?.lat) m.setView([value.lat, value.lng], 15); else m.fitBounds(SYRIA);
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 18, maxZoom: 19 }).addTo(m);
    fetch('data/basemap.json').then((r) => r.json()).then((b) => {
      if (!map.current) return;
      L.geoJSON(b.subdistricts, { style: { color: '#ffffff', weight: 0.6, opacity: 0.6, fill: false }, interactive: false }).addTo(m);
      L.geoJSON(b.governorates, { style: { color: '#c4ae7c', weight: 1.6, fill: false }, interactive: false }).addTo(m);
    }).catch(() => {});
    m.on('click', (e) => onPick({ lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) }));
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (pin.current) { pin.current.remove(); pin.current = null; }
    if (value?.lat) {
      pin.current = L.circleMarker([value.lat, value.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#d9534f', fillOpacity: 1 }).addTo(m);
    }
  }, [value?.lat, value?.lng]);

  return <div ref={box} className="q-geo__map" role="application" aria-label="انقر على الخريطة لتحديد الموقع" />;
}
