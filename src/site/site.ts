import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { GeocodedResult } from "../types";

// Configuration
const CONFIG = {
    usePMTiles: true, // Toggle this to false for OSM Raster
    pmtilesUrl: "new-york.pmtiles",
    filterToNYC: true, // Toggle this to filter displayed data to NYC Metro
    nycBounds: {
        minLng: -74.3,
        minLat: 40.49,
        maxLng: -73.6,
        maxLat: 41.0
    }
};

export async function getAllSites(): Promise<GeocodedResult[]> {
    const response = await fetch("output.json");
    return response.json();
}

export function initMap() {
    let mapStyle: maplibregl.StyleSpecification;

    if (CONFIG.usePMTiles) {
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);

        mapStyle = {
            version: 8,
            glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
            sources: {
                "protomaps": {
                    type: "vector",
                    url: `pmtiles://${CONFIG.pmtilesUrl}`,
                    attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>'
                }
            },
            layers: [
                {
                    "id": "background",
                    "type": "background",
                    "paint": { "background-color": "#e0e0e0" }
                },
                {
                    "id": "water",
                    "type": "fill",
                    "source": "protomaps",
                    "source-layer": "water",
                    "paint": { "fill-color": "#a0c8f0" }
                },
                {
                    "id": "roads",
                    "type": "line",
                    "source": "protomaps",
                    "source-layer": "roads",
                    "paint": { "line-color": "#ffffff", "line-width": 1 }
                },
                {
                    "id": "road_labels",
                    "type": "symbol",
                    "source": "protomaps",
                    "source-layer": "roads",
                    "minzoom": 12,
                    "layout": {
                        "symbol-placement": "line",
                        "text-field": ["get", "name"],
                        "text-size": 12,
                        "text-font": ["Noto Sans Regular"]
                    },
                    "paint": {
                        "text-color": "#666",
                        "text-halo-color": "#fff",
                        "text-halo-width": 2
                    }
                },
                {
                    "id": "buildings",
                    "type": "fill",
                    "source": "protomaps",
                    "source-layer": "buildings",
                    "paint": { "fill-color": "#d0d0d0" }
                },
                {
                    "id": "places",
                    "type": "symbol",
                    "source": "protomaps",
                    "source-layer": "places",
                    "layout": { "text-field": ["get", "name"], "text-size": 12, "text-font": ["Noto Sans Regular"] },
                    "paint": { "text-color": "#444", "text-halo-color": "#fff", "text-halo-width": 2 }
                }
            ]
        };
    } else {
        // OSM Raster Fallback
        mapStyle = {
            version: 8,
            sources: {
                'osm': {
                    'type': 'raster',
                    'tiles': [
                        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    'tileSize': 256,
                    'attribution': '&copy; OpenStreetMap Contributors'
                }
            },
            layers: [
                {
                    'id': 'osm-tiles',
                    'type': 'raster',
                    'source': 'osm',
                    'minzoom': 0,
                    'maxzoom': 19
                }
            ]
        };
    }

    const map = new maplibregl.Map({
        container: 'map',
        style: mapStyle,
        center: [-74.0, 40.7], // Default to NYC center
        zoom: 10
    });

    map.on('load', async () => {
        const sites = await getAllSites();
        
        // Filter logic
        let validSites = sites.filter((s): s is GeocodedResult & { lat: number; lng: number } => !!(s.lat && s.lng));
        
        if (CONFIG.filterToNYC) {
            const b = CONFIG.nycBounds;
            validSites = validSites.filter(s => 
                s.lng >= b.minLng && s.lng <= b.maxLng &&
                s.lat >= b.minLat && s.lat <= b.maxLat
            );
        }

        function getGeoJson(filteredSites: typeof validSites): GeoJSON.FeatureCollection {
            return {
                type: 'FeatureCollection',
                features: filteredSites.map(s => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [s.lng, s.lat]
                    },
                    properties: {
                        description: `<strong>${s.contractor}</strong><br>` +
                                     `${s.street}, ${s.city}, ${s.zip}<br>` +
                                     `Start: ${s.start.split('T')[0]}<br>End: ${s.end.split('T')[0]}`
                    }
                }))
            };
        }
        
        // Initial data source
        map.addSource('asbestos-projects', {
            type: 'geojson',
            data: getGeoJson(validSites)
        });

        // Add circle layer
        map.addLayer({
            'id': 'projects-circles',
            'type': 'circle',
            'source': 'asbestos-projects',
            'paint': {
                'circle-color': '#ff0000',
                'circle-radius': 6,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff'
            }
        });

        // Search functionality
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        const searchResults = document.getElementById('search-results');

        if (searchInput && searchResults) {
            // Helper to center and popup
            const focusOnSite = (site: typeof validSites[0]) => {
                map.flyTo({
                    center: [site.lng, site.lat],
                    zoom: 15
                });

                new maplibregl.Popup()
                    .setLngLat([site.lng, site.lat])
                    .setHTML(`<strong>${site.contractor}</strong><br>` +
                             `${site.street}, ${site.city}, ${site.zip}<br>` +
                             `Start: ${site.start.split('T')[0]}<br>End: ${site.end.split('T')[0]}`)
                    .addTo(map);
            };

            searchInput.addEventListener('input', (e) => {
                const query = (e.target as HTMLInputElement).value.toLowerCase();
                
                if (query.length === 0) {
                    searchResults.style.display = 'none';
                    // Reset to all valid sites
                    const source = map.getSource('asbestos-projects') as maplibregl.GeoJSONSource;
                    if (source) source.setData(getGeoJson(validSites));
                    return;
                }

                const filtered = validSites.filter(s => 
                    s.contractor.toLowerCase().includes(query) ||
                    s.city.toLowerCase().includes(query) ||
                    s.street.toLowerCase().includes(query) ||
                    s.zip.includes(query)
                );
                
                // Update Map
                const source = map.getSource('asbestos-projects') as maplibregl.GeoJSONSource;
                if (source) {
                    source.setData(getGeoJson(filtered));
                }

                // Update Dropdown
                searchResults.innerHTML = '';
                if (filtered.length > 0 && filtered.length < 10) {
                    filtered.forEach(site => {
                        const div = document.createElement('div');
                        div.className = 'result-item';
                        div.innerHTML = `<strong>${site.contractor}</strong>${site.street}, ${site.city}`;
                        div.addEventListener('click', () => {
                            searchInput.value = site.contractor;
                            searchResults.style.display = 'none';
                            // Filter map to just this one
                            source.setData(getGeoJson([site]));
                            focusOnSite(site);
                        });
                        searchResults.appendChild(div);
                    });
                    searchResults.style.display = 'block';
                } else {
                    searchResults.style.display = 'none';
                }

                // Auto-center if single result
                if (filtered.length === 1) {
                    focusOnSite(filtered[0]);
                }
            });

            // Hide dropdown on click outside
            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target as Node) && !searchResults.contains(e.target as Node)) {
                    searchResults.style.display = 'none';
                }
            });
        }

        // Popup logic
        map.on('click', 'projects-circles', (e) => {
            if (e.features && e.features.length > 0) {
                const coordinates = (e.features[0].geometry as any).coordinates.slice();
                const description = e.features[0].properties.description;

                new maplibregl.Popup()
                    .setLngLat(coordinates)
                    .setHTML(description)
                    .addTo(map);
            }
        });

        // Change cursor on hover
        map.on('mouseenter', 'projects-circles', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'projects-circles', () => {
            map.getCanvas().style.cursor = '';
        });
        
        // Fit bounds to data
        const bounds = new maplibregl.LngLatBounds();
        validSites.forEach(s => {
            bounds.extend([s.lng, s.lat]);
        });
        if (!bounds.isEmpty()) {
            map.fitBounds(bounds, { padding: 50 });
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initMap();

    // Register Service Worker for tile caching
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').then(registration => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }, err => {
                console.log('ServiceWorker registration failed: ', err);
            });
        });
    }
});