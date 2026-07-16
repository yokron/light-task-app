const STORAGE_KEY = "light-task-app-state-v1";
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const defaultState = {
  excelSchema: null,
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
let projectSearch = "";
let projectFilter = "all";

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
      excelSchema: parsed.excelSchema || null,
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

function taskColumns() {
  if (state.excelSchema?.taskColumns?.length) return state.excelSchema.taskColumns;
  const template = state.templates[0];
  return (template?.tasks || []).map((task) => ({ name: task.name, weight: Number(task.weight) || 0 }));
}

function setTaskColumns(columns) {
  state.excelSchema = {
    ...(state.excelSchema || {}),
    taskColumns: columns.map((column) => ({ name: column.name, weight: Number(column.weight) || 0 }))
  };
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
  const columns = taskColumns();
  if (!state.projects.length) {
    projectList.innerHTML = `<div class="panel empty-state"><h3>还没有项目</h3><p class="muted">可以导入 Excel，也可以从模板新建项目。</p></div>`;
    return;
  }

  const currentIds = new Set(state.projects.map((project) => project.id));
  selectedProjectIds.forEach((id) => {
    if (!currentIds.has(id)) selectedProjectIds.delete(id);
  });

  const filtered = state.projects.filter((project) => {
    const matchesSearch = !projectSearch || project.name.toLowerCase().includes(projectSearch.toLowerCase());
    const matchesFilter = projectFilter === "all"
      || (projectFilter === "active" && projectProgress(project) < 100)
      || (projectFilter === "done" && projectProgress(project) === 100)
      || (projectFilter === "late" && project.tasks.some((task) => !task.done && diffDays(todayISO(), task.dueDate) > 0));
    return matchesSearch && matchesFilter;
  });

  const header = columns.map((column) => `<th class="matrix-task-head"><span>${escapeHtml(column.name)}</span><small>${Number(column.weight) || 0}%</small></th>`).join("");
  const weightHeader = columns.map((column) => `<th>${Number(column.weight) || 0}%</th>`).join("");
  const rows = filtered.map((project) => {
    const progress = projectProgress(project);
    const status = projectStatus(project);
    const taskCells = columns.map((column, index) => {
      const task = project.tasks[index] || { name: column.name, weight: column.weight, done: false, completedAt: "" };
      const value = task.done ? (task.completedAt || "✓") : "";
      return `<td class="matrix-task-cell ${task.done ? "is-done" : ""}"><input class="matrix-cell-input" type="text" inputmode="numeric" value="${escapeHtml(value)}" placeholder="—" data-matrix-project="${project.id}" data-matrix-task="${index}" aria-label="${escapeHtml(project.name)} ${escapeHtml(column.name)}"></td>`;
    }).join("");
    return `<tr data-project-row="${project.id}">
      <td class="matrix-project-cell"><div class="matrix-project-name"><input class="matrix-select" type="checkbox" ${selectedProjectIds.has(project.id) ? "checked" : ""} data-action="select-project" data-id="${project.id}" aria-label="选择 ${escapeHtml(project.name)}"><input class="matrix-name-input" value="${escapeHtml(project.name)}" data-matrix-name="${project.id}" aria-label="项目名称"></div></td>
      ${taskCells}
      <td class="matrix-date-cell"><input type="date" value="${escapeHtml(project.dueDate || "")}" data-matrix-due="${project.id}" aria-label="预计报告交付日期"></td>
      <td class="matrix-progress-cell"><strong>${progress}%</strong><small class="pill ${status.tone}">${escapeHtml(status.text)}</small></td>
      <td class="matrix-action-cell"><button class="icon-button" type="button" data-action="edit-project" data-id="${project.id}" aria-label="编辑 ${escapeHtml(project.name)}" title="打开项目详情">↗</button></td>
    </tr>`;
  }).join("");

  projectList.innerHTML = `
    <div class="matrix-toolbar">
      <div class="matrix-toolbar-main"><strong>${selectedProjectIds.size} 个项目已选</strong><span class="muted">直接在任务格内填写完成日期或 ✓</span></div>
      <div class="matrix-toolbar-actions">
        <label class="matrix-search"><span class="sr-only">搜索项目</span><input id="projectSearchInput" type="search" value="${escapeHtml(projectSearch)}" placeholder="搜索项目"></label>
        <select id="projectFilterSelect" aria-label="筛选项目">
          <option value="all" ${projectFilter === "all" ? "selected" : ""}>全部项目</option>
          <option value="active" ${projectFilter === "active" ? "selected" : ""}>进行中</option>
          <option value="late" ${projectFilter === "late" ? "selected" : ""}>有延误</option>
          <option value="done" ${projectFilter === "done" ? "selected" : ""}>已完成</option>
        </select>
        <button class="secondary-button" type="button" data-action="select-all-projects">全选</button>
        <button class="secondary-button" type="button" data-action="clear-project-selection">清空</button>
      </div>
    </div>
    <div class="matrix-scroll">
      <table class="project-matrix">
        <thead><tr><th class="matrix-project-head" rowspan="2">项目名称</th>${header}<th rowspan="2" class="matrix-delivery-head">预计交付</th><th rowspan="2" class="matrix-progress-head">项目进度</th><th rowspan="2" class="matrix-action-head"></th></tr><tr class="matrix-weight-row">${weightHeader}</tr></thead>
        <tbody>${rows || `<tr><td class="matrix-empty" colspan="${columns.length + 4}">没有符合条件的项目</td></tr>`}</tbody>
      </table>
    </div>`;
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
    <div class="form-grid project-editor-form">
      <label><span>项目名称</span><input name="name" required value="${escapeHtml(project?.name || "")}" placeholder="例如：7 月课程上线"></label>
      <label><span>模板</span><input name="templateName" readonly value="${escapeHtml(project?.templateName || template?.name || "自定义")}"></label>
      <label><span>开始日期</span><input name="startDate" type="date" required value="${startDate}"></label>
      <label><span>预计完成日期</span><input name="dueDate" type="date" required value="${project?.dueDate || addDays(startDate, sumDays(template?.tasks || []))}"></label>
      <div>
        <h3>项目子任务</h3>
        <div class="task-editor" id="projectTaskEditor">
          ${sourceTasks.map((task) => `
            <div class="task-row project-task-row" data-id="${escapeHtml(task.id || uid())}">
              <label class="task-done-field"><span class="sr-only">完成</span><input data-field="done" type="checkbox" aria-label="完成任务" ${task.done ? "checked" : ""}></label>
              <label class="task-name-field"><span class="sr-only">子任务</span><input data-field="name" required value="${escapeHtml(task.name)}" placeholder="输入子任务"></label>
              <div class="task-inline-tools">
                <details class="task-tool">
                  <summary aria-label="占比">%</summary>
                  <label><span>占比 %</span><input data-field="weight" type="number" min="1" max="100" required value="${task.weight}"></label>
                </details>
                <details class="task-tool">
                  <summary aria-label="预计完成日期" title="预计完成日期">
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v6.5M13 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/>
                      <circle cx="17" cy="17" r="4"/><path d="M17 15v2l1.5 1"/>
                    </svg>
                  </summary>
                  <label><span>预计日期</span><input data-field="dueDate" type="date" required value="${task.dueDate}"></label>
                </details>
                <details class="task-tool">
                  <summary aria-label="实际完成日期" title="实际完成日期">
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v5M12 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/>
                      <path d="m15 18 2 2 4-5"/>
                    </svg>
                  </summary>
                  <label class="task-completed-field"><span>实际完成日期</span><input data-field="completedAt" type="date" value="${escapeHtml(task.completedAt || "")}" ${task.done ? "" : "disabled"}></label>
                </details>
              </div>
              <details class="task-advanced">
                <summary>更多</summary>
                <div class="task-advanced-grid">
                  <label class="task-note-field"><span>备注</span><textarea data-field="note" placeholder="说明进展、滞后原因或需要协同的事项">${escapeHtml(task.note || "")}</textarea></label>
                  <button class="icon-button remove-task" type="button" aria-label="删除子任务">×</button>
                </div>
              </details>
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

function normalizeExcelDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(/(\d{4})[\/-年](\d{1,2})[\/-月](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function importExcel(file) {
  if (!window.XLSX) return alert("Excel 解析组件尚未加载，请刷新页面后重试。");
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const workbook = XLSX.read(reader.result, { type: "array", cellDates: false, raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).includes("项目名称")));
      if (headerIndex < 0) throw new Error("找不到项目名称表头");
      const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
      const weights = rows[headerIndex + 1] || [];
      const expectedIndex = headers.findIndex((header) => /预计.*(交付|完成)/.test(header));
      const summaryIndex = headers.findIndex((header) => /项目(进度|状态|汇总)/.test(header));
      const taskBoundary = expectedIndex > 1 ? expectedIndex : summaryIndex > 1 ? summaryIndex : headers.length;
      const columns = headers.slice(1, taskBoundary).filter(Boolean).map((name, index) => ({ name, weight: Number(weights[index + 1]) || 0 }));
      if (!columns.length) throw new Error("找不到任务列");
      if (!columns.some((column) => column.weight > 0)) {
        const base = Math.floor(100 / columns.length);
        let remainder = 100 - base * columns.length;
        columns.forEach((column) => {
          column.weight = base + (remainder > 0 ? 1 : 0);
          remainder -= 1;
        });
      }

      const projects = [];
      rows.slice(headerIndex + 2).forEach((row) => {
        const name = String(row[0] || "").trim();
        if (!name) return;
        const dueDate = normalizeExcelDate(row[expectedIndex]);
        const tasks = columns.map((column, index) => {
          const rawValue = String(row[index + 1] || "").trim();
          const completedAt = normalizeExcelDate(rawValue);
          const done = Boolean(rawValue) && !/^(待完成|未完成|未开始|进行中|计划)$/i.test(rawValue);
          return { id: uid(), name: column.name, weight: column.weight, dueDate: dueDate || todayISO(), completedAt, done, note: "" };
        });
        const completedDates = tasks.map((task) => task.completedAt).filter(Boolean).sort();
        projects.push({ id: uid(), name, templateName: file.name, startDate: completedDates[0] || todayISO(), dueDate: dueDate || addDays(todayISO(), 30), tasks });
      });
      if (!projects.length) throw new Error("没有读到项目行");
      state.excelSchema = { fileName: file.name, taskColumns: columns, importedAt: todayISO() };
      state.projects = projects;
      state.templates = [{ id: uid(), name: file.name.replace(/\.(xlsx|xlsm?|xls)$/i, ""), note: "由 Excel 表格导入", tasks: columns.map((column) => ({ id: uid(), name: column.name, weight: column.weight, days: 1 })) }];
      selectedProjectIds.clear();
      render();
      alert(`已导入 ${projects.length} 个项目和 ${columns.length} 个任务节点。`);
    } catch (error) {
      alert(`Excel 导入失败：${error.message || "请确认表格结构"}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportExcel() {
  if (!window.XLSX) return alert("Excel 导出组件尚未加载，请刷新页面后重试。");
  const columns = taskColumns();
  const expectedHeader = state.excelSchema?.expectedHeader || "预计报告交付";
  const headers = ["项目名称", ...columns.map((column) => column.name), expectedHeader, "项目进度", "项目状态", "项目汇总"];
  const rows = [
    ["项目进度跟踪表"],
    ["更新时间：", todayISO()],
    headers,
    ["", ...columns.map((column) => Number(column.weight) || 0), "", "", "", ""]
  ];
  state.projects.forEach((project) => {
    const values = columns.map((column, index) => {
      const task = project.tasks[index];
      return task?.done ? (task.completedAt || "✓") : "";
    });
    const progress = projectProgress(project);
    rows.push([project.name, ...values, project.dueDate || "", `${progress}%`, projectStatus(project).text, `${progress}%\n${projectStatus(project).text}`]);
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  sheet["!cols"] = [{ wch: 30 }, ...columns.map(() => ({ wch: 12 })), { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 20 }];
  sheet["!freeze"] = { xSplit: 1, ySplit: 4 };
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, sheet, "项目跟踪表");
  XLSX.writeFile(out, `项目进度跟踪表-${todayISO()}.xlsx`);
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
    <title>项目路线图</title>
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
  const columns = taskColumns();
  const columnHeader = columns.map((column) => `<div class="roadmap-column-head" style="width:${Number(column.weight) || 0}%"><strong>${escapeHtml(column.name)}</strong><small>${Number(column.weight) || 0}%</small></div>`).join("");
  return `
    <article class="roadmap-report">
      <header class="roadmap-report-head">
        <div>
          <p class="roadmap-kicker">PROJECT ROADMAP</p>
          <h1>项目路线图</h1>
        </div>
        <p>${projects.length} 个项目</p>
      </header>
      <div class="roadmap-column-header">${columnHeader}</div>
      <div class="roadmap-grid">
        ${projects.map((project) => roadmapProjectRow(project)).join("")}
      </div>
      <footer class="roadmap-legend">
        <span><i class="legend-swatch complete"></i>已完成</span>
        <span><i class="legend-swatch open"></i>未完成</span>
      </footer>
    </article>
  `;
}

function roadmapProjectRow(project) {
  const status = projectStatus(project);
  const progress = projectProgress(project);
  const segments = project.tasks.map((task, index) => {
    const width = Math.max(0, Number(task.weight) || 0);
    const tone = task.done ? "complete" : "open";
    return `<div class="roadmap-segment ${tone}" style="width:${width}%"><span class="roadmap-node">${index + 1}</span></div>`;
  }).join("");
  const labels = project.tasks.map((task) => {
    const width = Math.max(0, Number(task.weight) || 0);
    const completion = task.done ? (task.completedAt || "已完成") : "待完成";
    return `<div class="roadmap-task-detail" style="width:${width}%"><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(completion)}</small></div>`;
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
    @page { size: landscape; margin: 7mm; }
    * { box-sizing: border-box; }
    html, body { width: 100%; }
    body { margin: 0; color: #17231f; font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .roadmap-report { width: 100%; max-width: none; }
    .roadmap-report-head { display: flex; justify-content: space-between; align-items: end; gap: 18px; padding-bottom: 6px; border-bottom: 2px solid #17231f; }
    .roadmap-kicker { margin: 0 0 3px; color: #1b7f65; font-size: 9px; font-weight: 800; letter-spacing: 1.5px; }
    h1 { margin: 0; font-size: 21px; }
    .roadmap-report-head > p { margin: 0; color: #66736d; }
    .roadmap-column-header { display: flex; min-width: 0; margin: 7px 0 2px; border: 1px solid #c9d0c9; background: #f1f5f1; }
    .roadmap-column-head { min-width: 3px; box-sizing: border-box; padding: 4px 3px; border-right: 1px solid #c9d0c9; text-align: center; }
    .roadmap-column-head:last-child { border-right: 0; }
    .roadmap-column-head strong, .roadmap-column-head small { display: block; overflow-wrap: anywhere; }
    .roadmap-column-head strong { color: #435149; font-size: 8px; line-height: 1.1; }
    .roadmap-column-head small { margin-top: 2px; color: #66736d; font-size: 7px; }
    .roadmap-project { padding: 6px 0 7px; border-bottom: 1px solid #dfe4df; break-inside: avoid; page-break-inside: avoid; }
    .roadmap-project-label { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-bottom: 4px; }
    .roadmap-project-label strong { min-width: 0; overflow-wrap: anywhere; font-size: 11px; }
    .roadmap-project-label span { color: #66736d; font-size: 10px; }
    .roadmap-segment-area { min-width: 0; }
    .roadmap-segments { display: flex; min-width: 0; }
    .roadmap-segments { height: 20px; border: 1px solid #86958c; background: #f7faf7; }
    .roadmap-segment { position: relative; flex: 0 0 auto; min-width: 3px; border-right: 1px solid #86958c; background: #fffdf7; }
    .roadmap-segment:last-child { border-right: 0; }
    .roadmap-segment.complete { background: #1b7f65; }
    .roadmap-segment.open { background: #fffdf7; }
    .roadmap-segment-labels { display: flex; min-width: 0; min-height: 28px; margin-top: 3px; }
    .roadmap-task-detail { flex: 0 0 auto; min-width: 0; box-sizing: border-box; padding: 0 3px; text-align: center; }
    .roadmap-task-detail strong, .roadmap-task-detail small { display: block; min-width: 0; }
    .roadmap-task-detail strong { overflow-wrap: anywhere; color: #435149; font-size: 8.5px; font-weight: 700; line-height: 1.15; }
    .roadmap-task-detail small { margin-top: 2px; overflow-wrap: anywhere; color: #66736d; font-size: 7.5px; line-height: 1.1; white-space: normal; }
    @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    .roadmap-node { position: absolute; inset: 0; display: grid; place-items: center; color: #435149; font-size: 8px; font-weight: 700; line-height: 1; text-align: center; }
    .roadmap-segment.complete .roadmap-node { color: #fff; }
    .roadmap-bar { position: absolute; z-index: 2; min-width: 4px; height: 18px; margin-top: 8px; overflow: hidden; border-radius: 4px; color: #fff; font-size: 10px; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
    .roadmap-bar span { padding: 0 7px; }
    .roadmap-bar.project-window { z-index: 1; height: 4px; margin-top: 0; border-radius: 0; background: #bdc8c0; }
    .roadmap-bar.complete { background: #1b7f65; }
    .roadmap-bar.active { background: #2f67a8; }
    .roadmap-bar.late { background: #b54747; }
    .roadmap-milestone { position: absolute; z-index: 3; top: 5px; width: 14px; height: 14px; margin-left: -7px; transform: rotate(45deg); border: 2px solid #17231f; background: #fffdf7; }
    .roadmap-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 7px; color: #66736d; font-size: 9px; }
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
  if (target.id === "downloadBtn") exportData();
  if (target.id === "exportXlsxBtn" || target.id === "exportXlsxDataBtn") exportExcel();
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
  if (event.target.matches("#projectFilterSelect")) {
    projectFilter = event.target.value;
    renderProjects();
    return;
  }
  if (event.target.matches("#projectSearchInput")) {
    projectSearch = event.target.value.trim();
    renderProjects();
    return;
  }
  if (event.target.matches("[data-matrix-name]")) {
    const project = state.projects.find((item) => item.id === event.target.dataset.matrixName);
    if (project) project.name = event.target.value.trim() || project.name;
    render();
    return;
  }
  if (event.target.matches("[data-matrix-due]")) {
    const project = state.projects.find((item) => item.id === event.target.dataset.matrixDue);
    if (project) {
      project.dueDate = event.target.value;
      project.tasks.forEach((task) => { if (!task.done) task.dueDate = event.target.value || task.dueDate; });
    }
    render();
    return;
  }
  if (event.target.matches("[data-matrix-project][data-matrix-task]")) {
    const project = state.projects.find((item) => item.id === event.target.dataset.matrixProject);
    const task = project?.tasks[Number(event.target.dataset.matrixTask)];
    if (project && task) {
      const value = event.target.value.trim();
      task.done = Boolean(value);
      task.completedAt = normalizeExcelDate(value) || (value === "✓" ? (task.completedAt || todayISO()) : "");
      saveState();
      renderProjects();
    }
    return;
  }
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

$("#xlsxImportFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importExcel(file);
  event.target.value = "";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
