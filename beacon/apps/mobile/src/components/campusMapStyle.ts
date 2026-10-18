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
      paint: { "background-color": "#F3F5F1" },
    },
    {
      id: "parks",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "park"],
      paint: { "fill-color": "#DCE8D9" },
    },
    {
      id: "water",
      type: "fill",
      source: "campus",
      filter: ["all", ["==", "kind", "water"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": "#C7DFE6" },
    },
    {
      id: "buildings",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "building"],
      paint: { "fill-color": "#D4DCD7", "fill-outline-color": "#B5C1BA" },
    },
    {
      id: "roads",
      type: "line",
      source: "campus",
      filter: ["==", "kind", "road"],
      paint: {
        "line-color": "#8C9A92",
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 4],
      },
    },
  ],
};
