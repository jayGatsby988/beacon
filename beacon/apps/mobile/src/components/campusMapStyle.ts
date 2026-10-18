import campus from "../../assets/maps/uw-campus.json";

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
      paint: { "background-color": "#F1F2F0" },
    },
    {
      id: "parks",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "park"],
      paint: { "fill-color": "#E1E6DF" },
    },
    {
      id: "water",
      type: "fill",
      source: "campus",
      filter: ["all", ["==", "kind", "water"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": "#CCD8DF" },
    },
    {
      id: "buildings",
      type: "fill",
      source: "campus",
      filter: ["==", "kind", "building"],
      paint: { "fill-color": "#D9DCDA", "fill-outline-color": "#BFC4C1" },
    },
    {
      id: "roads",
      type: "line",
      source: "campus",
      filter: ["==", "kind", "road"],
      paint: {
        "line-color": "#FFFFFF",
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 4],
      },
    },
  ],
};
