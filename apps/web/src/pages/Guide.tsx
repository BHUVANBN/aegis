import { Link } from 'react-router-dom';
import { Badge, PageHeader, Section, gateBadge, levelBadge } from '../components/ui';

export default function Guide() {
  return (
    <>
      <PageHeader title="Guide" subtitle="How AEGIS decides, who does what, and how to use this dashboard." />

      <Section title="What AEGIS does">
        <p>
          Before a pipeline changes your Azure infrastructure, it shows AEGIS a preview of the change. AEGIS scores the risk, then answers
          allow, ask a person, or block. After the deployment it checks that what exists in Azure matches what was approved, and it looks for
          changes made outside any pipeline.
        </p>
        <ol className="steps">
          <li>A developer changes the infrastructure code and a pipeline runs.</li>
          <li>The pipeline sends AEGIS the preview of the change (an Azure What-If).</li>
          <li>AEGIS classifies each resource, checks rules and dependencies, and scores the risk.</li>
          <li>The gate decides. Blocked changes stop. Some changes need a different person to approve them.</li>
          <li>The pipeline deploys exactly the artifact AEGIS authorized, once.</li>
          <li>AEGIS verifies the result and records everything in a tamper-evident audit trail.</li>
        </ol>
        <p>
          AEGIS judges infrastructure changes only. It does not review application code, and it can only judge what pipelines send it.
        </p>
      </Section>

      <Section title="Risk levels and what happens next">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Risk levels">
          <table>
            <caption className="sr-only">Risk levels and typical outcomes</caption>
            <thead>
              <tr>
                <th scope="col">Risk</th>
                <th scope="col">Typical outcome</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{levelBadge('low')}</th>
                <td>{gateBadge('allow')}</td>
                <td>Small, reversible change with complete evidence. It goes straight through.</td>
              </tr>
              <tr>
                <th scope="row">{levelBadge('medium')}</th>
                <td>{gateBadge('require_approval')}</td>
                <td>Needs a second pair of eyes in production.</td>
              </tr>
              <tr>
                <th scope="row">{levelBadge('high')}</th>
                <td>{gateBadge('require_approval')}</td>
                <td>Significant impact. A different person with the approver role must approve.</td>
              </tr>
              <tr>
                <th scope="row">{levelBadge('critical')}</th>
                <td>{gateBadge('block')}</td>
                <td>Matches a prohibited or very dangerous pattern. It cannot be approved; change the proposal.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          The decision is made by fixed rules and arithmetic, not by an AI model. Missing evidence lowers confidence and can turn an automatic
          allow into a request for approval.
        </p>
      </Section>

      <Section title="Roles">
        <dl className="details">
          <dt>
            <Badge kind="none">viewer</Badge>
          </dt>
          <dd>Reads assessments and the business-value dashboard.</dd>
          <dt>
            <Badge kind="none">assessor</Badge>
          </dt>
          <dd>Submits assessments and asks for approval.</dd>
          <dt>
            <Badge kind="none">approver</Badge>
          </dt>
          <dd>Decides approval requests, never their own.</dd>
          <dt>
            <Badge kind="none">admin</Badge>
          </dt>
          <dd>
            Manages projects and access on the <Link to="/setup">Setup</Link> page and reads the audit trail.
          </dd>
          <dt>
            <Badge kind="none">pipeline</Badge>
          </dt>
          <dd>For automation only: authorizes deployments and records results.</dd>
        </dl>
        <p className="muted">
          Access needs two things: an app role in Microsoft Entra and a grant on the environment. See Setup, then Access.
        </p>
      </Section>

      <Section title="Where the numbers come from">
        <ul className="plain">
          <li>
            <strong>Measured</strong> numbers are counted or timed directly from AEGIS records.
          </li>
          <li>
            <strong>Estimates</strong> multiply measured counts by assumptions you can change in <Link to="/settings#assumptions">Settings</Link>.
            They are labelled everywhere they appear.
          </li>
          <li>Sample assessments are marked and excluded from business numbers unless you include them.</li>
        </ul>
      </Section>

      <Section title="Using the dashboard with a keyboard or screen reader">
        <ul className="plain">
          <li>
            Press <kbd>Tab</kbd> to move forward and <kbd>Shift</kbd>+<kbd>Tab</kbd> back. The first Tab stop on every page is a link that
            skips the menu.
          </li>
          <li>In tab lists, use the left and right arrow keys, <kbd>Home</kbd> and <kbd>End</kbd>.</li>
          <li>
            <kbd>Esc</kbd> closes dialogs and returns you to where you were.
          </li>
          <li>Every chart has a text description and a data table behind &ldquo;View this chart as a table&rdquo;.</li>
          <li>
            Status is always written out (for example &ldquo;Blocked&rdquo;) as well as coloured. Themes, including a high-contrast one, are
            in <Link to="/settings">Settings</Link>.
          </li>
        </ul>
      </Section>
    </>
  );
}
