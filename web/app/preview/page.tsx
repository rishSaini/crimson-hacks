import { RoutePreview, type PreviewSample } from "@/components/RoutePreview";
import type { SuggestionsRequest } from "@/lib/api";
import samples from "../../../data/routes/source-samples/previews.json";
import demo from "../../../fixtures/suggestions.request.json";
import matchSketch from "../../../fixtures/suggestions.match-sketch.json";

export default function PreviewPage() {
  return (
    <RoutePreview
      samples={samples as PreviewSample[]}
      demo={demo as SuggestionsRequest}
      matchSketch={matchSketch as SuggestionsRequest["route"]["coordinates"]}
    />
  );
}
