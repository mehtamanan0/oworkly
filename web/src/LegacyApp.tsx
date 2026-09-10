import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { OrgStructure } from "./pages/OrgStructure";
import { ProcessDetail } from "./pages/ProcessDetail";
import { SkillMatrix } from "./pages/SkillMatrix";
import { Workers } from "./pages/Workers";
import { WorkerDetail } from "./pages/WorkerDetail";
import { Certificates } from "./pages/Certificates";
import { CertificateVerify } from "./pages/CertificateVerify";
import { GapAnalysis } from "./pages/GapAnalysis";
import { MyJourney } from "./pages/MyJourney";
import { MyCertificates } from "./pages/MyCertificates";
import { IngestionReport } from "./pages/IngestionReport";

export default function App() {
  return (
    <Routes>
      <Route path="/verify/:qrToken" element={<CertificateVerify />} />
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/org" element={<OrgStructure />} />
              <Route path="/processes/:id" element={<ProcessDetail />} />
              <Route path="/skill-matrix" element={<SkillMatrix />} />
              <Route path="/workers" element={<Workers />} />
              <Route path="/workers/:id" element={<WorkerDetail />} />
              <Route path="/certificates" element={<Certificates />} />
              <Route path="/gap-analysis" element={<GapAnalysis />} />
              <Route path="/ingestion" element={<IngestionReport />} />
              <Route path="/me" element={<MyJourney />} />
              <Route path="/me/certificates" element={<MyCertificates />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}
