import { Navigate, Route, Routes } from "react-router-dom";
import LegacyApp from "./LegacyApp";
import { ProtectedRoute } from "./lib/ProtectedRoute";

import { SignIn } from "./pagesV2/auth/SignIn";
import { WorkerLogin } from "./pagesV2/auth/WorkerLogin";
import { WorkerVerify } from "./pagesV2/auth/WorkerVerify";
import { WorkerPortalDashboard } from "./pagesV2/worker/WorkerPortalDashboard";
import { WorkerQuiz } from "./pagesV2/worker/WorkerQuiz";

import { TrainerDashboard } from "./pagesV2/dashboard/TrainerDashboard";
import { WorkerSearch } from "./pagesV2/workers/WorkerSearch";
import { WorkerMaster } from "./pagesV2/workers/WorkerMaster";
import { DataSources } from "./pagesV2/workers/DataSources";
import { SkillProfile } from "./pagesV2/workers/SkillProfile";

import { AssessmentPackage } from "./pagesV2/qualifications/AssessmentPackage";
import { Evaluate } from "./pagesV2/qualifications/Evaluate";
import { Result } from "./pagesV2/qualifications/Result";
import { Approval } from "./pagesV2/qualifications/Approval";
import { Certification } from "./pagesV2/qualifications/Certification";

import { SkillMatrix } from "./pagesV2/reports/SkillMatrix";
import { ManagementDashboard } from "./pagesV2/reports/ManagementDashboard";

import { AdminOverview } from "./pagesV2/admin/AdminOverview";
import { Companies } from "./pagesV2/admin/Companies";
import { OrgHierarchy } from "./pagesV2/admin/OrgHierarchy";
import { ProcessesLevels } from "./pagesV2/admin/ProcessesLevels";
import { AssessmentConfig } from "./pagesV2/admin/AssessmentConfig";
import { SkillMatrixConfig } from "./pagesV2/admin/SkillMatrixConfig";
import { ProductMaster } from "./pagesV2/admin/ProductMaster";
import { UserManagement } from "./pagesV2/admin/UserManagement";

export default function App() {
  return (
    <Routes>
      {/* ---- Public / auth ---- */}
      <Route path="/login" element={<SignIn />} />
      <Route path="/worker-login" element={<WorkerLogin />} />
      <Route path="/worker-verify" element={<WorkerVerify />} />

      {/* ---- Worker Self-Assessment Portal ---- */}
      <Route path="/worker/dashboard" element={<ProtectedRoute requireWorker><WorkerPortalDashboard /></ProtectedRoute>} />
      <Route path="/worker/quiz/:attemptId" element={<ProtectedRoute requireWorker><WorkerQuiz /></ProtectedRoute>} />

      {/* ---- Staff app ---- */}
      <Route path="/dashboard" element={<ProtectedRoute><TrainerDashboard /></ProtectedRoute>} />

      <Route path="/workers" element={<ProtectedRoute><WorkerMaster /></ProtectedRoute>} />
      <Route path="/workers/search" element={<ProtectedRoute><WorkerSearch /></ProtectedRoute>} />
      <Route path="/workers/data-sources" element={<ProtectedRoute><DataSources /></ProtectedRoute>} />
      <Route path="/workers/:workerId/profile" element={<ProtectedRoute><SkillProfile /></ProtectedRoute>} />

      <Route path="/assessments/package/:qualificationCaseId" element={<ProtectedRoute><AssessmentPackage /></ProtectedRoute>} />
      <Route path="/assessments/:attemptId/evaluate" element={<ProtectedRoute><Evaluate /></ProtectedRoute>} />

      <Route path="/qualifications" element={<Navigate to="/dashboard" replace />} />
      <Route path="/qualifications/:qualificationCaseId/result" element={<ProtectedRoute><Result /></ProtectedRoute>} />
      <Route path="/qualifications/:qualificationCaseId/approval" element={<ProtectedRoute><Approval /></ProtectedRoute>} />
      <Route path="/qualifications/:qualificationCaseId/certification" element={<ProtectedRoute><Certification /></ProtectedRoute>} />

      <Route path="/skill-matrix" element={<ProtectedRoute><SkillMatrix /></ProtectedRoute>} />
      <Route path="/reports/management-dashboard" element={<ProtectedRoute><ManagementDashboard /></ProtectedRoute>} />

      <Route path="/admin" element={<ProtectedRoute><AdminOverview /></ProtectedRoute>} />
      <Route path="/admin/companies" element={<ProtectedRoute><Companies /></ProtectedRoute>} />
      <Route path="/admin/org-hierarchy" element={<ProtectedRoute><OrgHierarchy /></ProtectedRoute>} />
      <Route path="/admin/processes" element={<ProtectedRoute><ProcessesLevels /></ProtectedRoute>} />
      <Route path="/admin/assessments/library" element={<ProtectedRoute><AssessmentConfig tab="library" /></ProtectedRoute>} />
      <Route path="/admin/assessments/level-links" element={<ProtectedRoute><AssessmentConfig tab="level-links" /></ProtectedRoute>} />
      <Route path="/admin/assessments/question-bank" element={<ProtectedRoute><AssessmentConfig tab="question-bank" /></ProtectedRoute>} />
      <Route path="/admin/assessments/question-bank/:definitionId" element={<ProtectedRoute><AssessmentConfig tab="question-bank" /></ProtectedRoute>} />
      <Route path="/admin/skill-matrix-config" element={<ProtectedRoute><SkillMatrixConfig /></ProtectedRoute>} />
      <Route path="/admin/product-master" element={<ProtectedRoute><ProductMaster /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />

      {/* ---- Legacy MVP demo (pre-Figma-redesign) — kept reachable, not the default experience ---- */}
      <Route path="/legacy-mvp/*" element={<LegacyApp />} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
