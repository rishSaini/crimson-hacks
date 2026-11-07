import { ApiCheck } from "@/components/ApiCheck";
import { MapView } from "@/components/MapView";

export default function Home() {
  return (
    <main className="flex h-screen flex-col md:flex-row">
      <div className="min-h-0 flex-1">
        <MapView />
      </div>
      <aside className="overflow-y-auto border-t p-4 md:w-96 md:border-t-0 md:border-l">
        <ApiCheck />
      </aside>
    </main>
  );
}
