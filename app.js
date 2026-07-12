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

const $ = (selector) => document.querySelector(selector);
const summaryBand = $("#summaryBand");
const projectList = $("#projectList");
const templateList = $("#templateList");
const dialog = $("#editorDialog");
const editorForm = $("#editorForm");
const editorFields = $("#editorFields");
const dialogTitle = $("#dialogTitle");

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

  projectList.innerHTML = state.projects.map((project) => {
    const progress = projectProgress(project);
    const status = projectStatus(project);
    const taskHtml = project.tasks.map((task) => {
      const status = taskStatus(task);
      return `
        <div class="task-line">
          <input type="checkbox" ${task.done ? "checked" : ""} data-action="toggle-task" data-project="${project.id}" data-task="${task.id}" aria-label="完成 ${escapeHtml(task.name)}">
          <div class="task-main">
            <strong>${escapeHtml(task.name)}</strong>
            <small>${task.weight}% · 预计 ${formatDate(task.dueDate)}${task.done ? ` · 实际 ${formatDate(task.completedAt)}` : ""}</small>
          </div>
          <span class="pill ${status.tone}">${status.text}</span>
        </div>
      `;
    }).join("");

    return `
      <article class="card">
        <div class="card-head">
          <div class="card-title">
            <h3>${escapeHtml(project.name)}</h3>
            <p class="muted">${escapeHtml(project.templateName || "自定义项目")}</p>
          </div>
          <span class="pill ${status.tone}">${status.text}</span>
        </div>
        <div class="meta-row">
          <span class="pill">开始 ${formatDate(project.startDate)}</span>
          <span class="pill">截止 ${formatDate(project.dueDate)}</span>
          <span class="pill good">${progress}%</span>
        </div>
        <div class="progress" aria-label="项目进度 ${progress}%"><span style="width:${progress}%"></span></div>
        <div class="task-list">${taskHtml}</div>
        <div class="actions">
          <button class="secondary-button" type="button" data-action="edit-project" data-id="${project.id}">编辑</button>
          <button class="danger-button" type="button" data-action="delete-project" data-id="${project.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");
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
  tasks.forEach((task) => addTaskRow(task));
  updateWeightHint();
  dialog.showModal();
}

function addTaskRow(task = { name: "", weight: 10, days: 1 }) {
  const template = $("#taskRowTemplate").content.cloneNode(true);
  template.querySelector('[data-field="name"]').value = task.name || "";
  template.querySelector('[data-field="weight"]').value = task.weight || 10;
  template.querySelector('[data-field="days"]').value = task.days || 1;
  $("#taskEditor").appendChild(template);
}

function readTaskRows() {
  return [...document.querySelectorAll("#taskEditor .task-row")].map((row) => ({
    id: uid(),
    name: row.querySelector('[data-field="name"]').value.trim(),
    weight: Number(row.querySelector('[data-field="weight"]').value),
    days: Number(row.querySelector('[data-field="days"]').value)
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
    done: false
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
            <div class="task-row project-task-row" data-done="${task.done ? "1" : "0"}" data-completed="${escapeHtml(task.completedAt || "")}">
              <label><span>子任务</span><input data-field="name" required value="${escapeHtml(task.name)}"></label>
              <label><span>占比 %</span><input data-field="weight" type="number" min="1" max="100" required value="${task.weight}"></label>
              <label><span>预计日期</span><input data-field="dueDate" type="date" required value="${task.dueDate}"></label>
              <button class="icon-button remove-task" type="button" aria-label="删除子任务">×</button>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
  `;
  dialog.dataset.templateId = template?.id || project?.templateId || "";
  dialog.showModal();
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
  dialog.showModal();
}

function sumDays(tasks) {
  return tasks.reduce((sum, task) => sum + Number(task.days || 0), 0);
}

function readProjectTaskRows() {
  return [...document.querySelectorAll("#projectTaskEditor .project-task-row")].map((row) => ({
    id: uid(),
    name: row.querySelector('[data-field="name"]').value.trim(),
    weight: Number(row.querySelector('[data-field="weight"]').value),
    dueDate: row.querySelector('[data-field="dueDate"]').value,
    done: row.dataset.done === "1",
    completedAt: row.dataset.completed || ""
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

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, input[type='checkbox']");
  if (!target) return;

  if (target.matches(".tab")) switchView(target.dataset.view);
  if (target.id === "newTemplateBtn") openTemplateEditor();
  if (target.id === "newProjectBtn") openProjectPicker();
  if (target.id === "downloadBtn" || target.id === "exportBtn") exportData();
  if (target.id === "addTaskRowBtn") {
    addTaskRow();
    updateWeightHint();
  }
  if (target.matches(".remove-task")) {
    target.closest(".task-row")?.remove();
    updateWeightHint();
  }

  const action = target.dataset.action;
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
    render();
  }
  if (action === "toggle-task") toggleTask(target.dataset.project, target.dataset.task, target.checked);
});

document.addEventListener("input", (event) => {
  if (event.target.closest("#taskEditor")) updateWeightHint();
});

editorForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  if (!validateBeforeSave()) return;
  saveDialog();
});

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
