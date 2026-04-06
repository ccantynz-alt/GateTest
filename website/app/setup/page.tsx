/**
 * /setup — One-Click GitHub App Setup (Admin Only)
 *
 * This page handles initial app creation and configuration.
 * After setup, customers just click "Connect GitHub" on the main site.
 */

export const metadata = {
  title: "GateTest — Setup",
};

export default function SetupPage() {
  const appSlug = process.env.GATETEST_APP_SLUG || "gatetest-qa";
  const isConfigured = !!process.env.GATETEST_APP_ID;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">GateTest Setup</h1>
        <p className="text-gray-400 mb-8">
          Configure the GitHub App that gives GateTest access to scan repos.
        </p>

        {isConfigured ? (
          <div className="space-y-6">
            <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
              <h2 className="text-green-400 font-semibold text-lg">
                App Configured
              </h2>
              <p className="text-green-300 text-sm mt-1">
                GateTest GitHub App is ready. Customers can install it now.
              </p>
            </div>

            <div className="bg-[#12121a] rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg">Customer Install Link</h3>
              <p className="text-gray-400 text-sm">
                Share this link or embed the button on your site:
              </p>
              <code className="block bg-black/50 p-3 rounded text-cyan-400 text-sm break-all">
                https://github.com/apps/{appSlug}/installations/new
              </code>

              <a
                href={`https://github.com/apps/${appSlug}/installations/new`}
                className="inline-block bg-white text-black font-semibold px-6 py-3 rounded-lg hover:bg-gray-200 transition"
              >
                Install GateTest on Repos
              </a>
            </div>

            <div className="bg-[#12121a] rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg">API Status</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between">
                  <span className="text-gray-400">Webhook endpoint</span>
                  <span className="text-green-400">/api/webhook</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-400">OAuth callback</span>
                  <span className="text-green-400">/api/github/callback</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-400">Repos API</span>
                  <span className="text-green-400">/api/github/repos</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-400">Scan API</span>
                  <span className="text-green-400">/api/github/scan</span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4">
              <h2 className="text-yellow-400 font-semibold text-lg">
                Setup Required
              </h2>
              <p className="text-yellow-300 text-sm mt-1">
                Create the GitHub App to get started. One click does it all.
              </p>
            </div>

            <div className="bg-[#12121a] rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg">
                Option 1: Automatic (Recommended)
              </h3>
              <p className="text-gray-400 text-sm">
                Click below to create the GitHub App automatically with all the
                right permissions. GitHub will redirect you back with the
                credentials.
              </p>
              <a
                href="/api/github/setup?action=create"
                className="inline-block bg-white text-black font-semibold px-6 py-3 rounded-lg hover:bg-gray-200 transition"
              >
                Create GitHub App Automatically
              </a>
            </div>

            <div className="bg-[#12121a] rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg">Option 2: Manual</h3>
              <p className="text-gray-400 text-sm">
                Create the app manually at GitHub, then set these env vars in
                Vercel:
              </p>
              <pre className="bg-black/50 p-4 rounded text-sm text-gray-300 overflow-x-auto">
{`GATETEST_APP_ID=<from GitHub>
GATETEST_APP_SLUG=<from GitHub>
GATETEST_PRIVATE_KEY=<.pem file contents>
GATETEST_WEBHOOK_SECRET=<your secret>
GITHUB_CLIENT_ID=<from GitHub>
GITHUB_CLIENT_SECRET=<from GitHub>`}
              </pre>
              <a
                href="https://github.com/settings/apps/new"
                className="inline-block border border-gray-600 px-4 py-2 rounded hover:border-white transition text-sm"
              >
                Create App Manually on GitHub
              </a>
            </div>

            <div className="bg-[#12121a] rounded-lg p-6 space-y-4">
              <h3 className="font-semibold text-lg">Required Permissions</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left">
                    <th className="pb-2">Permission</th>
                    <th className="pb-2">Access</th>
                    <th className="pb-2">Why</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr>
                    <td className="py-1">Contents</td>
                    <td>Read</td>
                    <td>Read repo files to scan</td>
                  </tr>
                  <tr>
                    <td className="py-1">Metadata</td>
                    <td>Read</td>
                    <td>Required by GitHub</td>
                  </tr>
                  <tr>
                    <td className="py-1">Commit statuses</td>
                    <td>Read & Write</td>
                    <td>Set pass/fail on commits</td>
                  </tr>
                  <tr>
                    <td className="py-1">Pull requests</td>
                    <td>Read & Write</td>
                    <td>Comment scan results on PRs</td>
                  </tr>
                  <tr>
                    <td className="py-1">Issues</td>
                    <td>Read & Write</td>
                    <td>Create issues for critical findings</td>
                  </tr>
                  <tr>
                    <td className="py-1">Checks</td>
                    <td>Read & Write</td>
                    <td>CI/CD integration</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
