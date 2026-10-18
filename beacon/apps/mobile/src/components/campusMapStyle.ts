import campus from "../../assets/maps/uw-campus.json";

// Coverage requested from OSM. Complete ways can extend beyond this rectangle.
export const CAMPUS_BOUNDS: [number, number, number, number] = [
  campus.metadata.coverageBounds[0],
  campus.metadata.coverageBounds[1],
  campus.metadata.coverageBounds[2],
  campus.metadata.coverageBounds[3],
];

export const campusStyle = {
  version: 8,
  sources: {
    campus: {
      type: "geojson",
      data: campus,
      attribution: "© OpenStreetMap contributors · ODbL",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#182229" },
    },
    {
      id: "parks",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "park"],
      paint: { "fill-color": "#243A33" },
    },
    {
      id: "water",
      type: "fill",
      source: "campus",
      filter: ["all", ["==", "kind", "water"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": "#142F40" },
    },
    {
      id: "buildings",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "building"],
      paint: { "fill-color": "#30404B", "fill-outline-color": "#43515B" },
    },
    {
      id: "roads",
      type: "line",
      source: "campus",
      filter: ["==", "kind", "road"],
      paint: {
        "line-color": "#596772",
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 4],
      },
    },
  ],
};
