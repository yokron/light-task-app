const STORAGE_KEY = "light-task-app-state-v1";
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultState = {
  templates: [
    {
      id: uid(),
      name: "内容发布模板",
      note: "适合文章、视频、活动页等重复交付。",
      tasks: [
        { id: uid(), name: "选题确认", weight: 15, days: 1 },
        { id: uid(), name: "素材准备", weight: 25, days: 2 },
        { id: uid(), name: "制作与初稿", weight: 35, days: 4 },
        { id: uid(), name: "审核修改", weight: 15, days: 2 },
        { id: uid(), name: "发布复盘", weight: 10, days: 1 }
      ]
    }
  ],
  projects: []
};

let state = loadState();
let activeView = "projects";
let dialogMode = null;
let editingId = null;
let lockedScrollY = 0;
const selectedProjectIds = new Set();

const $ = (selector) => document.querySelector(selector);
const summaryBand = $("#summaryBand");
const projectList = $("#projectList");
const templateList = $("#templateList");
const dialog = $("#editorDialog");
const editorForm = $("#editorForm");
const editorFields = $("#editorFields");
const dialogTitle = $("#dialogTitle");
const printRoot = $("#printRoot");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return cloneDefaultState();
  try {
    const parsed = JSON.parse(saved);
    return {
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch {
    return cloneDefaultState();
  }
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function diffDays(left, right) {
  const a = new Date(`${left}T00:00:00`);
  const b = new Date(`${right}T00:00:00`);
  return Math.round((a - b) / 86400000);
}

function formatDate(dateText) {
  if (!dateText) return "未设置";
  const [year, month, day] = dateText.split("-");
  return `${month}/${day}`;
}

function totalWeight(tasks) {
  return tasks.reduce((sum, task) => sum + Number(task.weight || 0), 0);
}

function projectProgress(project) {
  const total = totalWeight(project.tasks);
  if (!total) return 0;
  const done = project.tasks
    .filter((task) => task.done)
    .reduce((sum, task) => sum + Number(task.weight || 0), 0);
  return Math.round((done / total) * 100);
}

function taskStatus(task) {
  if (task.done) {
    const late = diffDays(task.completedAt || todayISO(), task.dueDate);
    if (late < 0) return { text: `提前 ${Math.abs(late)} 天`, tone: "good" };
    if (late > 0) return { text: `延迟 ${late} 天`, tone: "bad" };
    return { text: "准时完成", tone: "good" };
  }
  const late = diffDays(todayISO(), task.dueDate);
  if (late > 0) return { text: `已延迟 ${late} 天`, tone: "bad" };
  if (late === 0) return { text: "今天到期", tone: "warn" };
  return { text: `剩余 ${Math.abs(late)} 天`, tone: "info" };
}

function projectStatus(project) {
  const progress = projectProgress(project);
  const done = progress === 100 && project.tasks.length > 0;
  if (done) {
    const doneDates = project.tasks
      .map((task) => task.completedAt || project.dueDate)
      .sort();
    const lastDone = doneDates[doneDates.length - 1];
    const late = diffDays(lastDone, project.dueDate);
    if (late < 0) return { text: `提前 ${Math.abs(late)} 天完成`, tone: "good" };
    if (late > 0) return { text: `延迟 ${late} 天完成`, tone: "bad" };
    return { text: "准时完成", tone: "good" };
  }
  const overdueCount = project.tasks.filter((task) => !task.done && diffDays(todayISO(), task.dueDate) > 0).length;
  if (overdueCount) return { text: `${overdueCount} 个子任务延迟`, tone: "bad" };
  const late = diffDays(todayISO(), project.dueDate);
  if (late > 0) return { text: `项目已延迟 ${late} 天`, tone: "bad" };
  if (late <= 3) return { text: "临近截止", tone: "warn" };
  return { text: "推进中", tone: "info" };
}

function render() {
  renderSummary();
  renderProjects();
  renderTemplates();
  saveState();
}

function renderSummary() {
  const activeProjects = state.projects.filter((project) => projectProgress(project) < 100);
  const delayedTasks = state.projects.flatMap((project) => project.tasks).filter((task) => {
    return !task.done && diffDays(todayISO(), task.dueDate) > 0;
  });
  const avgProgress = state.projects.length
    ? Math.round(state.projects.reduce((sum, project) => sum + projectProgress(project), 0) / state.projects.length)
    : 0;

  summaryBand.innerHTML = `
    <div class="metric"><strong>${activeProjects.length}</strong><span>进行中项目</span></div>
    <div class="metric"><strong>${delayedTasks.length}</strong><span>延迟子任务</span></div>
    <div class="metric"><strong>${avgProgress}%</strong><span>平均进度</span></div>
  `;
}

function renderProjects() {
  if (!state.projects.length) {
    projectList.innerHTML = `<div class="panel"><h3>还没有项目</h3><p class="muted">先从模板新建一个项目，后续就能按子任务勾选推进。</p></div>`;
    return;
  }

  const currentIds = new Set(state.projects.map((project) => project.id));
  selectedProjectIds.forEach((id) => {
    if (!currentIds.has(id)) selectedProjectIds.delete(id);
  });

  const bulkBar = `
    <div class="panel project-bulk">
      <div>
        <strong>已选 ${selectedProjectIds.size} 个项目</strong>
        <p class="muted">勾选项目后，可统一打印成一份报告。</p>
      </div>
      <div class="actions">
        <button class="secondary-button" type="button" data-action="select-all-projects">全选</button>
        <button class="secondary-button" type="button" data-action="clear-project-selection">清空</button>
        <button class="primary-button" type="button" data-action="print-roadmap-selected-projects">打印项目路线图</button>
      </div>
    </div>
  `;

  const cards = state.projects.map((project) => {
    const progress = projectProgress(project);
    const selected = selectedProjectIds.has(project.id);

    return `
      <article class="card project-card">
        <input class="project-card-select" type="checkbox" ${selected ? "checked" : ""} data-action="select-project" data-id="${project.id}" aria-label="选择 ${escapeHtml(project.name)}">
        <button class="project-card-open" type="button" data-action="edit-project" data-id="${project.id}" aria-label="编辑 ${escapeHtml(project.name)}">
          <span class="project-card-summary">
            <strong>${escapeHtml(project.name)}</strong>
            <span>${progress}%</span>
          </span>
          <span class="progress" aria-label="项目进度 ${progress}%"><span style="width:${progress}%"></span></span>
        </button>
      </article>
    `;
  }).join("");

  projectList.innerHTML = bulkBar + cards;
}

function renderTemplates() {
  if (!state.templates.length) {
    templateList.innerHTML = `<div class="panel"><h3>还没有模板</h3><p class="muted">建议先建一个常用流程模板，再从模板创建项目。</p></div>`;
    return;
  }

  templateList.innerHTML = state.templates.map((template) => {
    const weight = totalWeight(template.tasks);
    const tone = weight === 100 ? "good" : "warn";
    return `
      <article class="card">
        <div class="card-head">
          <div class="card-title">
            <h3>${escapeHtml(template.name)}</h3>
            <p class="muted">${escapeHtml(template.note || "无备注")}</p>
          </div>
          <span class="pill ${tone}">${weight}%</span>
        </div>
        <div class="task-list">
          ${template.tasks.map((task) => `
            <div class="task-line">
              <div class="task-main">
                <strong>${escapeHtml(task.name)}</strong>
                <small>${task.weight}% · 默认 ${task.days} 天</small>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="actions">
          <button class="primary-button" type="button" data-action="project-from-template" data-id="${template.id}">用它新建项目</button>
          <button class="secondary-button" type="button" data-action="edit-template" data-id="${template.id}">编辑</button>
          <button class="danger-button" type="button" data-action="delete-template" data-id="${template.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

function switchView(view) {
  activeView = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${view}View`));
}

function openTemplateEditor(template = null) {
  dialogMode = "template";
  editingId = template?.id || null;
  dialogTitle.textContent = template ? "编辑模板" : "新建模板";
  const tasks = template?.tasks?.length ? template.tasks : [{ id: uid(), name: "", weight: 100, days: 1 }];
  editorFields.innerHTML = `
    <div class="form-grid">
      <label><span>模板名称</span><input name="name" required value="${escapeHtml(template?.name || "")}"></label>
      <label><span>备注</span><textarea name="note">${escapeHtml(template?.note || "")}</textarea></label>
      <div>
        <div class="section-head">
          <h3>子任务</h3>
          <button class="secondary-button" type="button" id="addTaskRowBtn">增加子任务</button>
        </div>
        <div class="task-editor" id="taskEditor"></div>
        <p class="fineprint" id="weightHint"></p>
      </div>
    </div>
  `;
  const taskEditor = $("#taskEditor");
  tasks.forEach((task) => addTaskRow(task, !template));
  updateWeightHint();
  openDialog();
}

function addTaskRow(task = { name: "", weight: "", days: 1 }, autoWeight = false) {
  const template = $("#taskRowTemplate").content.cloneNode(true);
  const row = template.querySelector(".task-row");
  row.dataset.autoWeight = autoWeight ? "1" : "0";
  template.querySelector('[data-field="name"]').value = task.name || "";
  template.querySelector('[data-field="weight"]').value = task.weight ?? "";
  template.querySelector('[data-field="days"]').value = task.days || 1;
  template.querySelector('[data-field="note"]').value = task.note || "";
  $("#taskEditor").appendChild(template);
}

function canRebalanceTemplateWeights() {
  const rows = [...document.querySelectorAll("#taskEditor .task-row")];
  return rows.length > 0 && rows.every((row) => row.dataset.autoWeight === "1");
}

function rebalanceTemplateWeights() {
  const rows = [...document.querySelectorAll("#taskEditor .task-row")];
  if (!rows.length) return;
  const base = Math.floor(100 / rows.length);
  let remainder = 100 - (base * rows.length);
  rows.forEach((row) => {
    const weightInput = row.querySelector('[data-field="weight"]');
    weightInput.value = base + (remainder > 0 ? 1 : 0);
    row.dataset.autoWeight = "1";
    remainder -= 1;
  });
  updateWeightHint();
}

function readTaskRows() {
  return [...document.querySelectorAll("#taskEditor .task-row")].map((row) => ({
    id: uid(),
    name: row.querySelector('[data-field="name"]').value.trim(),
    weight: Number(row.querySelector('[data-field="weight"]').value),
    days: Number(row.querySelector('[data-field="days"]').value),
    note: row.querySelector('[data-field="note"]')?.value.trim() || ""
  })).filter((task) => task.name);
}

function updateWeightHint() {
  const rows = readTaskRows();
  const weight = totalWeight(rows);
  const hint = $("#weightHint");
  if (!hint) return;
  hint.textContent = weight === 100 ? "占比合计 100%，可以直接使用。" : `占比合计 ${weight}%，建议调整到 100%。`;
}

function openProjectEditor(project = null, template = null) {
  dialogMode = "project";
  editingId = project?.id || null;
  const startDate = project?.startDate || todayISO();
  const sourceTasks = project?.tasks || template?.tasks?.map((task) => ({
    id: uid(),
    name: task.name,
    weight: task.weight,
    dueDate: addDays(startDate, task.days),
    completedAt: "",
    done: false,
    note: task.note || ""
  })) || [];

  dialogTitle.textContent = project ? "编辑项目" : "新建项目";
  editorFields.innerHTML = `
    <div class="form-grid">
      <label><span>项目名称</span><input name="name" required value="${escapeHtml(project?.name || "")}" placeholder="例如：7 月课程上线"></label>
      <label><span>模板</span><input name="templateName" readonly value="${escapeHtml(project?.templateName || template?.name || "自定义")}"></label>
      <label><span>开始日期</span><input name="startDate" type="date" required value="${startDate}"></label>
      <label><span>预计完成日期</span><input name="dueDate" type="date" required value="${project?.dueDate || addDays(startDate, sumDays(template?.tasks || []))}"></label>
      <div>
        <h3>项目子任务</h3>
        <div class="task-editor" id="projectTaskEditor">
          ${sourceTasks.map((task) => `
            <div class="task-row project-task-row" data-id="${escapeHtml(task.id || uid())}">
              <label><span>子任务</span><input data-field="name" required value="${escapeHtml(task.name)}"></label>
              <label><span>占比 %</span><input data-field="weight" type="number" min="1" max="100" required value="${task.weight}"></label>
              <label><span>预计日期</span><input data-field="dueDate" type="date" required value="${task.dueDate}"></label>
              <button class="icon-button remove-task" type="button" aria-label="删除子任务">×</button>
              <label class="task-done-field"><span>完成</span><input data-field="done" type="checkbox" ${task.done ? "checked" : ""}></label>
              <label class="task-completed-field"><span>实际完成日期</span><input data-field="completedAt" type="date" value="${escapeHtml(task.completedAt || "")}" ${task.done ? "" : "disabled"}></label>
              <label class="task-note-field"><span>备注</span><textarea data-field="note" placeholder="说明进展、滞后原因或需要协同的事项">${escapeHtml(task.note || "")}</textarea></label>
            </div>
          `).join("")}
        </div>
      </div>
      ${project ? `
        <div class="project-editor-danger">
          <button class="danger-button" type="button" data-action="delete-project-editor" data-id="${project.id}">删除项目</button>
        </div>
      ` : ""}
    </div>
  `;
  dialog.dataset.templateId = template?.id || project?.templateId || "";
  openDialog();
}

function openProjectPicker() {
  if (!state.templates.length) return alert("请先创建模板。");
  dialogMode = "pick-template";
  editingId = null;
  dialogTitle.textContent = "选择模板";
  editorFields.innerHTML = `
    <div class="form-grid">
      <label>
        <span>项目模板</span>
        <select name="templateId" required>
          ${state.templates.map((template) => `
            <option value="${template.id}">${escapeHtml(template.name)} · ${totalWeight(template.tasks)}%</option>
          `).join("")}
        </select>
      </label>
      <p class="muted">建议选择占比合计为 100% 的模板。项目创建后仍可调整子任务日期和占比。</p>
    </div>
  `;
  openDialog();
}

function openDialog() {
  lockPageScroll();
  dialog.showModal();
}

function lockPageScroll() {
  if (document.body.classList.contains("dialog-open")) return;
  lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.classList.add("dialog-open");
  document.body.style.top = `-${lockedScrollY}px`;
}

function unlockPageScroll() {
  if (!document.body.classList.contains("dialog-open")) return;
  document.body.classList.remove("dialog-open");
  document.body.style.top = "";
  window.scrollTo(0, lockedScrollY);
}

function sumDays(tasks) {
  return tasks.reduce((sum, task) => sum + Number(task.days || 0), 0);
}

function readProjectTaskRows() {
  return [...document.querySelectorAll("#projectTaskEditor .project-task-row")].map((row) => ({
    id: row.dataset.id || uid(),
    name: row.querySelector('[data-field="name"]').value.trim(),
    weight: Number(row.querySelector('[data-field="weight"]').value),
    dueDate: row.querySelector('[data-field="dueDate"]').value,
    done: row.querySelector('[data-field="done"]').checked,
    completedAt: row.querySelector('[data-field="done"]').checked
      ? row.querySelector('[data-field="completedAt"]').value
      : "",
    note: row.querySelector('[data-field="note"]')?.value.trim() || ""
  })).filter((task) => task.name);
}

function saveDialog() {
  const formData = new FormData(editorForm);
  if (dialogMode === "template") {
    const template = {
      id: editingId || uid(),
      name: String(formData.get("name")).trim(),
      note: String(formData.get("note") || "").trim(),
      tasks: readTaskRows()
    };
    if (!template.tasks.length) return alert("至少需要一个子任务。");
    const index = state.templates.findIndex((item) => item.id === editingId);
    if (index >= 0) state.templates[index] = template;
    else state.templates.unshift(template);
    switchView("templates");
  }

  if (dialogMode === "project") {
    const project = {
      id: editingId || uid(),
      templateId: dialog.dataset.templateId || "",
      templateName: String(formData.get("templateName") || "自定义"),
      name: String(formData.get("name")).trim(),
      startDate: String(formData.get("startDate")),
      dueDate: String(formData.get("dueDate")),
      tasks: readProjectTaskRows()
    };
    if (!project.tasks.length) return alert("至少需要一个子任务。");
    const index = state.projects.findIndex((item) => item.id === editingId);
    if (index >= 0) state.projects[index] = project;
    else state.projects.unshift(project);
    switchView("projects");
  }
  if (dialogMode === "pick-template") {
    const template = state.templates.find((item) => item.id === String(formData.get("templateId")));
    dialog.close();
    openProjectEditor(null, template);
    return;
  }
  dialog.close();
  render();
}

function validateBeforeSave() {
  const invalidFields = [...editorForm.elements].filter((field) => {
    return field.willValidate && !field.checkValidity();
  });
  if (!invalidFields.length) return true;

  const missingLabels = [...new Set(invalidFields
    .filter((field) => field.validity.valueMissing)
    .map((field) => fieldLabel(field))
  )];

  if (missingLabels.length) {
    alert(`请填写必填字段：${missingLabels.join("、")}`);
  } else {
    alert("请检查表单中的数值范围。");
  }

  invalidFields[0].focus();
  invalidFields[0].reportValidity();
  return false;
}

function fieldLabel(field) {
  return field.closest("label")?.querySelector("span")?.textContent?.trim()
    || field.name
    || "未命名字段";
}

function toggleTask(projectId, taskId, checked) {
  const project = state.projects.find((item) => item.id === projectId);
  const task = project?.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.done = checked;
  task.completedAt = checked ? (task.completedAt || todayISO()) : "";
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `light-task-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function printRoadmap(projects) {
  if (!projects.length) return alert("请先选择要打印的项目");
  const reportHtml = projectsToRoadmapHtml(projects);
  const printWindow = window.open("", "_blank");

  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 350);
    return;
  }

  printRoot.innerHTML = roadmapReportBody(projects);
  window.setTimeout(() => window.print(), 50);
}

function projectsToRoadmapHtml(projects) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>项目路线图-${todayISO()}</title>
    <style>${roadmapDocumentCss()}</style>
  </head>
  <body>${roadmapReportBody(projects)}</body>
</html>`;
}

function projectsToGanttHtml(projects) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>详细甘特图-${todayISO()}</title>
    <style>${ganttDocumentCss()}</style>
  </head>
  <body>${ganttReportBody(projects)}</body>
</html>`;
}

function roadmapReportBody(projects) {
  const dates = projects.flatMap((project) => [project.startDate, project.dueDate, ...project.tasks.map((task) => task.dueDate)])
    .filter(Boolean)
    .sort();
  if (!dates.length) return `<p>没有可用于路线图的日期。</p>`;

  const start = dates[0];
  const end = dates[dates.length - 1];
  const totalDays = Math.max(diffDays(end, start) + 1, 1);
  const ticks = buildRoadmapTicks(start, end);
  const tickHtml = ticks.map((tick) => {
    const left = (diffDays(tick.date, start) / totalDays) * 100;
    return `<span class="roadmap-tick" style="left:${left}%"><b>${escapeHtml(tick.label)}</b></span>`;
  }).join("");

  return `
    <article class="roadmap-report">
      <header class="roadmap-report-head">
        <div>
          <p class="roadmap-kicker">PROJECT ROADMAP</p>
          <h1>项目路线图</h1>
        </div>
        <p>${projects.length} 个项目 · ${formatDate(start)} - ${formatDate(end)} · 生成于 ${todayISO()}</p>
      </header>
      <div class="roadmap-scale"><div class="roadmap-scale-inner">${tickHtml}</div></div>
      <div class="roadmap-grid">
        ${projects.map((project) => roadmapProjectRow(project, start, totalDays)).join("")}
      </div>
      <footer class="roadmap-legend">
        <span><i class="legend-swatch complete"></i>已完成</span>
        <span><i class="legend-swatch open"></i>未完成</span>
        <span><i class="legend-node"></i>任务节点</span>
      </footer>
    </article>
  `;
}

function roadmapProjectRow(project, start, totalDays) {
  const status = projectStatus(project);
  const progress = projectProgress(project);
  const segments = project.tasks.map((task) => {
    const width = Math.max(0, Number(task.weight) || 0);
    const tone = task.done ? "complete" : "open";
    return `<div class="roadmap-segment ${tone}" style="width:${width}%">${task.done ? '<span class="roadmap-complete-mark">✓</span>' : ''}</div>`;
  }).join("");
  const labels = project.tasks.map((task, index) => {
    const width = Math.max(0, Number(task.weight) || 0);
    const completion = task.done ? (task.completedAt || "已完成") : "待完成";
    return `<div class="roadmap-segment-label" style="width:${width}%"><span class="roadmap-node">${index + 1}</span><strong title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</strong><small>${escapeHtml(completion)}</small></div>`;
  }).join("");

  return `<section class="roadmap-project">
    <div class="roadmap-project-label">
      <strong>${escapeHtml(project.name)}</strong>
      <span>${progress}% · ${project.tasks.length} 项任务 · ${escapeHtml(status.text)}</span>
    </div>
    <div class="roadmap-segment-area">
      <div class="roadmap-segments">${segments}</div>
      <div class="roadmap-segment-labels">${labels}</div>
    </div>
  </section>`;
}

function ganttReportBody(projects) {
  const dates = projects.flatMap((project) => [project.startDate, project.dueDate, ...project.tasks.map((task) => task.dueDate), ...project.tasks.map((task) => task.completedAt)])
    .filter(Boolean)
    .sort();
  if (!dates.length) return `<p>没有可用于甘特图的日期。</p>`;

  const start = dates[0];
  const end = dates[dates.length - 1];
  const totalDays = Math.max(diffDays(end, start) + 1, 1);
  const tickHtml = buildRoadmapTicks(start, end).map((tick) => {
    const left = (diffDays(tick.date, start) / totalDays) * 100;
    return `<span class="gantt-tick" style="left:${left}%"><b>${escapeHtml(tick.label)}</b></span>`;
  }).join("");

  return `<article class="gantt-report">
    <header class="gantt-report-head">
      <div><p class="roadmap-kicker">DETAILED GANTT</p><h1>详细甘特图</h1></div>
      <p>${projects.length} 个项目 · ${formatDate(start)} - ${formatDate(end)} · 生成于 ${todayISO()}</p>
    </header>
    <div class="gantt-scale"><div class="gantt-scale-inner">${tickHtml}</div></div>
    <div class="gantt-grid">${projects.map((project) => ganttProjectRows(project, start, totalDays)).join("")}</div>
    <footer class="gantt-legend">
      <span><i class="legend-swatch complete"></i>已完成</span>
      <span><i class="legend-swatch active"></i>进行中</span>
      <span><i class="legend-swatch late"></i>已延期</span>
    </footer>
  </article>`;
}

function ganttProjectRows(project, start, totalDays) {
  const projectStart = project.startDate || start;
  const projectEnd = project.dueDate || projectStart;
  const progress = projectProgress(project);
  const projectLeft = Math.max(0, diffDays(projectStart, start) / totalDays * 100);
  const projectWidth = Math.max(1.4, (diffDays(projectEnd, projectStart) + 1) / totalDays * 100);
  const projectHeader = `<div class="gantt-project-row"><div class="gantt-label project-label"><strong>${escapeHtml(project.name)}</strong><span>${progress}% · ${project.tasks.length} 项任务</span></div><div class="gantt-track project-track"><div class="gantt-project-window" style="left:${projectLeft}%;width:${Math.min(projectWidth, 100 - projectLeft)}%"></div></div></div>`;
  const taskRows = project.tasks.map((task) => {
    const taskEnd = task.dueDate || projectEnd;
    const taskStart = task.done && task.completedAt ? task.completedAt : projectStart;
    const left = Math.max(0, diffDays(taskStart, start) / totalDays * 100);
    const width = Math.max(1.4, (diffDays(taskEnd, taskStart) + 1) / totalDays * 100);
    const tone = task.done ? "complete" : diffDays(todayISO(), taskEnd) > 0 ? "late" : "active";
    return `<div class="gantt-task-row"><div class="gantt-label task-label"><span>${escapeHtml(task.name)}</span><small>${task.weight}% · ${escapeHtml(task.dueDate || "未设置日期")}</small></div><div class="gantt-track"><div class="gantt-bar ${tone}" style="left:${left}%;width:${Math.min(width, 100 - left)}%"><span>${task.done ? "已完成" : escapeHtml(task.name)}</span></div></div></div>`;
  }).join("");
  return projectHeader + taskRows;
}

function ganttDocumentCss() {
  return `
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17231f; font: 11px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .gantt-report { width: 100%; }
    .gantt-report-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #17231f; }
    .gantt-report-head h1 { margin: 0; font-size: 25px; }
    .gantt-report-head > p { margin: 0; color: #66736d; }
    .gantt-scale { margin-left: 220px; height: 34px; border-bottom: 1px solid #c9d0c9; }
    .gantt-scale-inner, .gantt-track { position: relative; height: 100%; }
    .gantt-tick { position: absolute; bottom: 0; height: 100%; border-left: 1px solid #d9ded8; color: #66736d; }
    .gantt-tick b { position: absolute; top: 5px; left: 5px; white-space: nowrap; font-size: 10px; font-weight: 600; }
    .gantt-project-row, .gantt-task-row { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 32px; border-bottom: 1px solid #e5e7e1; }
    .gantt-project-row { min-height: 44px; background: #f1f5f1; border-top: 1px solid #c9d0c9; }
    .gantt-label { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 5px 14px 5px 0; overflow-wrap: anywhere; }
    .gantt-label span, .gantt-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .gantt-label small { color: #66736d; font-size: 9px; }
    .task-label { padding-left: 16px; color: #435149; }
    .gantt-track { margin: 4px 0; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(14.285% - 1px), #eef0eb calc(14.285% - 1px), #eef0eb 14.285%); }
    .project-track { margin: 7px 0; }
    .gantt-project-window { position: absolute; top: 50%; height: 7px; transform: translateY(-50%); border-radius: 4px; background: #aabbb1; }
    .gantt-bar { position: absolute; top: 50%; min-width: 4px; height: 18px; transform: translateY(-50%); overflow: hidden; border-radius: 4px; color: #fff; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
    .gantt-bar span { padding: 0 7px; }
    .gantt-bar.complete { background: #1b7f65; }
    .gantt-bar.active { background: #2f67a8; }
    .gantt-bar.late { background: #b54747; }
    .gantt-legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; color: #66736d; font-size: 10px; }
    .gantt-legend span { display: inline-flex; align-items: center; gap: 5px; }
  `;
}

function buildRoadmapTicks(start, end) {
  const ticks = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    ticks.push({ date, label: formatDate(date) });
    cursor.setDate(cursor.getDate() + (diffDays(end, start) > 45 ? 14 : 7));
  }
  if (ticks[ticks.length - 1]?.date !== end) ticks.push({ date: end, label: formatDate(end) });
  return ticks;
}

function roadmapDocumentCss() {
  return `
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17231f; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .roadmap-report { width: 100%; }
    .roadmap-report-head { display: flex; justify-content: space-between; align-items: end; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #17231f; }
    .roadmap-kicker { margin: 0 0 3px; color: #1b7f65; font-size: 9px; font-weight: 800; letter-spacing: 1.5px; }
    h1 { margin: 0; font-size: 25px; }
    .roadmap-report-head > p { margin: 0; color: #66736d; }
    .roadmap-scale { margin-left: 220px; height: 34px; border-bottom: 1px solid #c9d0c9; }
    .roadmap-scale-inner { position: relative; height: 100%; }
    .roadmap-tick { position: absolute; bottom: 0; height: 100%; border-left: 1px solid #d9ded8; color: #66736d; }
    .roadmap-tick b { position: absolute; top: 5px; left: 5px; white-space: nowrap; font-size: 10px; font-weight: 600; }
    .roadmap-project { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 82px; border-bottom: 1px solid #e5e7e1; }
    .roadmap-project-label { display: grid; align-content: center; gap: 3px; padding: 7px 14px 7px 0; }
    .roadmap-project-label strong { overflow-wrap: anywhere; }
    .roadmap-project-label span { color: #66736d; font-size: 10px; }
    .roadmap-segment-area { min-width: 0; padding: 14px 0 8px; }
    .roadmap-segments, .roadmap-segment-labels { display: flex; min-width: 0; }
    .roadmap-segments { height: 22px; border: 1px solid #86958c; background: #f7faf7; }
    .roadmap-segment { position: relative; min-width: 3px; border-right: 1px solid #86958c; background: #fffdf7; }
    .roadmap-segment:last-child { border-right: 0; }
    .roadmap-segment.complete { border: 2px solid #1b7f65; background: #1b7f65; }
    .roadmap-segment.open { background: #fffdf7; }
    .roadmap-segment-label { position: relative; min-width: 0; padding: 9px 5px 0; text-align: center; border-left: 1px solid #c9d0c9; }
    .roadmap-segment-label:first-child { border-left: 0; }
    .roadmap-segment-label strong, .roadmap-segment-label small { display: block; overflow-wrap: anywhere; white-space: normal; }
    .roadmap-segment-label strong { color: #435149; font-size: 9px; font-weight: 700; line-height: 1.15; }
    .roadmap-segment-label small { margin-top: 3px; color: #66736d; font-size: 8px; line-height: 1.1; }
    .roadmap-complete-mark { position: absolute; inset: 0; color: #17231f; font-size: 12px; line-height: 18px; text-align: center; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .roadmap-segment.complete { border-width: 2px; } .roadmap-complete-mark { font-weight: 800; } }
    .roadmap-node { position: absolute; top: -9px; left: 0; width: 16px; height: 16px; transform: translateX(-50%); border: 1px solid #435149; border-radius: 50%; background: #fffdf7; color: #435149; font-size: 9px; line-height: 14px; text-align: center; }
    .roadmap-segment-label:last-child .roadmap-node { left: 100%; }
    .roadmap-bar { position: absolute; z-index: 2; min-width: 4px; height: 18px; margin-top: 8px; overflow: hidden; border-radius: 4px; color: #fff; font-size: 10px; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
    .roadmap-bar span { padding: 0 7px; }
    .roadmap-bar.project-window { z-index: 1; height: 4px; margin-top: 0; border-radius: 0; background: #bdc8c0; }
    .roadmap-bar.complete { background: #1b7f65; }
    .roadmap-bar.active { background: #2f67a8; }
    .roadmap-bar.late { background: #b54747; }
    .roadmap-milestone { position: absolute; z-index: 3; top: 5px; width: 14px; height: 14px; margin-left: -7px; transform: rotate(45deg); border: 2px solid #17231f; background: #fffdf7; }
    .roadmap-legend { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 16px; color: #66736d; font-size: 10px; }
    .roadmap-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend-swatch { width: 12px; height: 8px; border-radius: 2px; }
    .legend-swatch.complete { background: #1b7f65; }
    .legend-swatch.active { background: #2f67a8; }
    .legend-swatch.late { background: #b54747; }
    .legend-swatch.open { border: 1px solid #86958c; background: #fffdf7; }
    .legend-node { width: 11px; height: 11px; border: 1px solid #435149; border-radius: 50%; background: #fffdf7; }
    .legend-milestone { width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid #17231f; background: #fffdf7; }
  `;
}

function projectsToPrintHtml(projects) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>项目报告-${todayISO()}</title>
    <style>${printDocumentCss()}</style>
  </head>
  <body>${printReportBody(projects)}</body>
</html>`;
}

function printReportBody(projects) {
  return `
    <article class="print-report">
      <header class="print-report-head">
        <h1>项目报告</h1>
        <p>共 ${projects.length} 个项目 · 生成日期 ${todayISO()}</p>
      </header>
      ${projects.map(projectToPrintSection).join("")}
      <p class="print-footnote">由轻任务模板 App 生成。</p>
    </article>
  `;
}

function projectToPrintSection(project) {
  const status = projectStatus(project);
  const progress = projectProgress(project);
  return `
    <section class="print-project">
      <div class="print-project-title">
        <h2>${escapeHtml(project.name)}</h2>
        <strong>${progress}%</strong>
      </div>
      <p class="print-project-subtitle">${escapeHtml(project.templateName || "自定义项目")} · ${escapeHtml(status.text)}</p>
      <div class="print-meta">
        <span>开始 ${escapeHtml(project.startDate || "-")}</span>
        <span>预计 ${escapeHtml(project.dueDate || "-")}</span>
        <span>子任务 ${project.tasks.length}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>子任务</th>
            <th>占比</th>
            <th>计划/完成</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          ${project.tasks.map((task, index) => {
            const status = taskStatus(task);
            return `
              <tr>
                <td>${index + 1}</td>
                <td>${task.done ? "✓" : "□"} ${escapeHtml(task.name)}</td>
                <td>${task.weight}%</td>
                <td>${escapeHtml(task.dueDate || "-")} / ${escapeHtml(task.completedAt || "-")}<br><small>${escapeHtml(status.text)}</small></td>
                <td>${escapeHtml(task.note || "")}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function printDocumentCss() {
  return `
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .print-report { max-width: 186mm; margin: 0 auto; }
    .print-report-head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; border-bottom: 1px solid #111; margin-bottom: 8px; padding-bottom: 5px; }
    h1 { margin: 0; font-size: 18px; }
    h2 { margin: 0; font-size: 15px; }
    p { margin: 0; }
    .print-project { break-inside: avoid; page-break-inside: avoid; margin: 0 0 10px; padding-top: 6px; border-top: 1px solid #bbb; }
    .print-project-title { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .print-project-title strong { font-size: 14px; }
    .print-project-subtitle { margin-top: 2px; color: #444; }
    .print-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 5px 0; color: #333; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 4px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f2f2f2; font-weight: 700; }
    th:nth-child(1), td:nth-child(1) { width: 24px; text-align: center; }
    th:nth-child(3), td:nth-child(3) { width: 42px; text-align: right; }
    th:nth-child(4), td:nth-child(4) { width: 96px; }
    small { color: #555; }
    .print-footnote { margin-top: 8px; color: #666; font-size: 10px; }
  `;
}

function downloadTextFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.templates) || !Array.isArray(imported.projects)) {
        throw new Error("invalid schema");
      }
      state = imported;
      render();
      alert("导入成功。");
    } catch {
      alert("导入失败，请确认文件是本应用导出的 JSON。");
    }
  };
  reader.readAsText(file);
}

function selectedProjects() {
  return state.projects.filter((project) => selectedProjectIds.has(project.id));
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, input[type='checkbox']");
  if (!target) return;

  if (target.matches(".tab")) switchView(target.dataset.view);
  if (target.id === "newTemplateBtn") openTemplateEditor();
  if (target.id === "newProjectBtn") openProjectPicker();
  if (target.id === "downloadBtn" || target.id === "exportBtn") exportData();
  if (target.id === "addTaskRowBtn") {
    const shouldRebalance = canRebalanceTemplateWeights();
    addTaskRow({ name: "", weight: shouldRebalance ? 0 : "", days: 1 }, shouldRebalance);
    if (shouldRebalance) rebalanceTemplateWeights();
    else updateWeightHint();
  }
  if (target.matches(".remove-task")) {
    const shouldRebalance = target.closest("#taskEditor") && canRebalanceTemplateWeights();
    target.closest(".task-row")?.remove();
    if (shouldRebalance) rebalanceTemplateWeights();
    else updateWeightHint();
  }

  const action = target.dataset.action;
  if (action === "select-project") {
    if (target.checked) selectedProjectIds.add(target.dataset.id);
    else selectedProjectIds.delete(target.dataset.id);
    render();
  }
  if (action === "select-all-projects") {
    state.projects.forEach((project) => selectedProjectIds.add(project.id));
    render();
  }
  if (action === "clear-project-selection") {
    selectedProjectIds.clear();
    render();
  }
  if (action === "print-roadmap-selected-projects") printRoadmap(selectedProjects());
  if (action === "project-from-template") {
    const template = state.templates.find((item) => item.id === target.dataset.id);
    openProjectEditor(null, template);
  }
  if (action === "edit-template") openTemplateEditor(state.templates.find((item) => item.id === target.dataset.id));
  if (action === "delete-template" && confirm("删除这个模板？已有项目不会受影响。")) {
    state.templates = state.templates.filter((item) => item.id !== target.dataset.id);
    render();
  }
  if (action === "edit-project") openProjectEditor(state.projects.find((item) => item.id === target.dataset.id));
  if (action === "delete-project" && confirm("删除这个项目？")) {
    state.projects = state.projects.filter((item) => item.id !== target.dataset.id);
    selectedProjectIds.delete(target.dataset.id);
    render();
  }
  if (action === "delete-project-editor" && confirm("删除这个项目？删除后无法恢复。")) {
    state.projects = state.projects.filter((item) => item.id !== target.dataset.id);
    selectedProjectIds.delete(target.dataset.id);
    dialog.close();
    render();
  }
  if (action === "toggle-task") toggleTask(target.dataset.project, target.dataset.task, target.checked);
});

document.addEventListener("input", (event) => {
  if (event.target.matches('#taskEditor [data-field="weight"]')) {
    event.target.closest(".task-row").dataset.autoWeight = "0";
  }
  if (event.target.closest("#taskEditor")) updateWeightHint();
});

document.addEventListener("change", (event) => {
  if (!event.target.matches('.project-task-row [data-field="done"]')) return;
  const row = event.target.closest(".project-task-row");
  const completedAt = row.querySelector('[data-field="completedAt"]');
  completedAt.disabled = !event.target.checked;
  if (event.target.checked && !completedAt.value) completedAt.value = todayISO();
  if (!event.target.checked) completedAt.value = "";
});

editorForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  if (!validateBeforeSave()) return;
  saveDialog();
});

dialog.addEventListener("close", unlockPageScroll);

$("#importFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importData(file);
  event.target.value = "";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
