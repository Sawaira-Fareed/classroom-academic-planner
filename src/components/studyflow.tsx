"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/browser";

type TaskType = "Assignment" | "Lecture topic" | "Quiz / exam" | "Lab / demo" | "Revision" | "Other";
type CourseOrigin = "custom" | "google_classroom";
type Course = {
  id: string;
  name: string;
  code: string;
  section: string;
  instructor: string;
  origin: CourseOrigin;
  archived: boolean;
};
type Task = {
  id: string;
  sourceId: string | null;
  title: string;
  courseId: string | null;
  type: TaskType;
  due: string;
  notes: string;
  done: boolean;
  needsReview: boolean;
  description: string;
};
type StudyBlock = { id: string; title: string; date: string; start: string; end: string };
type ImportedSource = { id: string; provider: string; title: string; body: string; sourceUrl: string | null; publishedAt: string | null; courseId: string | null };
type GoogleCalendar = { id: string; name: string; accessRole: string };
type GoogleStatus = { connected: boolean; configured: boolean; email: string | null; lastSyncAt: string | null; calendarSelected: boolean };
type ProgressSnapshot = { snapshot_date: string; total_tasks: number; completed_tasks: number };
type Theme = "dark" | "light";
type Screen = "Dashboard" | "Calendar" | "Courses" | "Tasks" | "Announcements" | "Study Planner" | "Progress" | "Settings";
type BuddyMood = "Idle" | "Thinking" | "Celebrating" | "Needs Attention";

const taskTypes: TaskType[] = ["Assignment", "Lecture topic", "Quiz / exam", "Lab / demo", "Revision", "Other"];
const navigation: { name: Screen; icon: string }[] = [
  { name: "Dashboard", icon: "⌂" },
  { name: "Calendar", icon: "▦" },
  { name: "Courses", icon: "◇" },
  { name: "Tasks", icon: "☷" },
  { name: "Announcements", icon: "◉" },
  { name: "Study Planner", icon: "◷" },
  { name: "Progress", icon: "▥" },
  { name: "Settings", icon: "⚙" },
];
const tasksStorageKey = "studyflow.tasks.v1";
const coursesStorageKey = "studyflow.courses.v1";
const blocksStorageKey = "studyflow.study-blocks.v1";
const themeStorageKey = "studyflow.theme.v1";
const taskTypeToDatabase: Record<TaskType, string> = {
  Assignment: "assignment",
  "Lecture topic": "lecture_topic",
  "Quiz / exam": "quiz_exam",
  "Lab / demo": "lab_demo",
  Revision: "revision",
  Other: "other",
};

function taskTypeFromDatabase(value: string): TaskType {
  return Object.entries(taskTypeToDatabase).find(([, stored]) => stored === value)?.[0] as TaskType | undefined ?? "Other";
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function shortDate(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function readableDate(value: string) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function StarMark({ small = false }: { small?: boolean }) {
  return <span className={`star-mark${small ? " star-mark-small" : ""}`} aria-hidden="true">✳</span>;
}

function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 31;
  return (
    <div className="progress-ring" role="img" aria-label={`${value}% of tasks completed`}>
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle className="ring-track" cx="38" cy="38" r="31" />
        <circle
          className="ring-value"
          cx="38"
          cy="38"
          r="31"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch (error) {
    console.error(`Could not read local planner storage for ${key}.`, error);
    return fallback;
  }
}

export function StudyFlow() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [blocks, setBlocks] = useState<StudyBlock[]>([]);
  const [sources, setSources] = useState<ImportedSource[]>([]);
  const [progressHistory, setProgressHistory] = useState<ProgressSnapshot[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);
  const [screen, setScreen] = useState<Screen>("Dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<"All" | "Pending" | "Completed">("All");
  const [courseFilter, setCourseFilter] = useState("All courses");
  const [weekOffset, setWeekOffset] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [buddyMood, setBuddyMood] = useState<BuddyMood>("Idle");
  const [buddyMessage, setBuddyMessage] = useState("Your study companion is here when you need a nudge.");
  const [buddyPrompt, setBuddyPrompt] = useState("");
  const [buddyBusy, setBuddyBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formCourse, setFormCourse] = useState("");
  const [formType, setFormType] = useState<TaskType>("Assignment");
  const [formDue, setFormDue] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseSection, setCourseSection] = useState("");
  const [courseInstructor, setCourseInstructor] = useState("");
  const [dataMode, setDataMode] = useState<"loading" | "local" | "signed-out" | "cloud" | "error">("loading");
  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authBusy, setAuthBusy] = useState(false);
  const [dataError, setDataError] = useState("");
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, configured: false, email: null, lastSyncAt: null, calendarSelected: false });
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleNotice, setGoogleNotice] = useState("");
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState("");
  const [reloadCounter, setReloadCounter] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTheme(readStored<Theme>(themeStorageKey, "dark"));
    if (!supabase) {
      setBlocks(readStored<StudyBlock[]>(blocksStorageKey, []));
      setCourses(readStored<Course[]>(coursesStorageKey, []));
      setTasks(readStored<Task[]>(tasksStorageKey, []).map((task) => ({ ...task, sourceId: task.sourceId ?? null, needsReview: task.needsReview ?? false, description: task.description ?? "" })));
      setDataMode("local");
      setHydrated(true);
      return;
    }
    setBlocks([]);

    let active = true;
    const loadCloudData = async (userId: string) => {
      const [courseResult, taskResult, blockResult, sourceResult, progressResult] = await Promise.all([
        supabase.from("courses").select("id,name,course_code,section,instructor,origin,is_archived").eq("user_id", userId).order("name"),
        supabase.from("tasks").select("id,title,description,source_id,course_id,task_type,due_at,status,user_notes,completed_at").eq("user_id", userId).neq("status", "dismissed").order("due_at", { ascending: true, nullsFirst: false }),
        supabase.from("schedule_blocks").select("id,title,start_at,end_at").eq("user_id", userId).eq("is_deleted", false).order("start_at"),
        supabase.from("sources").select("id,provider,title,body,source_url,published_at,course_id").eq("user_id", userId).order("published_at", { ascending: false, nullsFirst: false }).limit(100),
        supabase.from("progress_snapshots").select("snapshot_date,total_tasks,completed_tasks").eq("user_id", userId).order("snapshot_date", { ascending: false }).limit(14),
      ]);
      if (!active) return;
      if (courseResult.error || taskResult.error || blockResult.error || sourceResult.error || progressResult.error) {
        setDataError(courseResult.error?.message ?? taskResult.error?.message ?? blockResult.error?.message ?? sourceResult.error?.message ?? progressResult.error?.message ?? "Could not load planner data.");
        setDataMode("error");
        return;
      }
      setCourses((courseResult.data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        code: row.course_code ?? "",
        section: row.section ?? "",
        instructor: row.instructor ?? "",
        origin: row.origin === "google_classroom" ? "google_classroom" : "custom",
        archived: row.is_archived,
      })));
      setTasks((taskResult.data ?? []).map((row) => ({
        id: row.id,
        sourceId: row.source_id,
        title: row.title,
        courseId: row.course_id,
        type: taskTypeFromDatabase(row.task_type),
        due: row.due_at?.slice(0, 10) ?? "",
        notes: row.user_notes ?? "",
        done: row.status === "completed",
        needsReview: row.status === "pending_review",
        description: row.description ?? "",
      })));
      setBlocks((blockResult.data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: dateKeyInTimezone(new Date(row.start_at), "Asia/Karachi"),
        start: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.start_at)),
        end: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(row.end_at)),
      })));
      setSources((sourceResult.data ?? []).map((row) => ({
        id: row.id, provider: row.provider, title: row.title, body: row.body ?? "",
        sourceUrl: row.source_url, publishedAt: row.published_at, courseId: row.course_id,
      })));
      setProgressHistory((progressResult.data ?? []).reverse());
      setDataError("");
      setDataMode("cloud");
    };

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setDataError(error.message);
        setDataMode("error");
      } else if (data.session) {
        setUserEmail(data.session.user.email ?? "");
        setUserId(data.session.user.id);
        void loadCloudData(data.session.user.id);
      } else {
        setUserId("");
        setDataMode("signed-out");
        setCourses([]);
        setTasks([]);
        setBlocks([]);
        setSources([]);
        setProgressHistory([]);
        setGoogleStatus((status) => ({ ...status, connected: false, email: null, lastSyncAt: null, calendarSelected: false }));
      }
      setHydrated(true);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setUserEmail(session.user.email ?? "");
        setUserId(session.user.id);
        void loadCloudData(session.user.id);
      } else {
        setUserId("");
        setUserEmail("");
        setCourses([]);
        setTasks([]);
        setBlocks([]);
        setSources([]);
        setProgressHistory([]);
        setGoogleStatus({ connected: false, configured: false, email: null, lastSyncAt: null, calendarSelected: false });
        setDataMode("signed-out");
      }
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase, reloadCounter]);

  useEffect(() => {
    if (dataMode !== "cloud" || !supabase || !userId) return;
    const currentTasks = tasks.filter((task) => !task.needsReview);
    const snapshotDate = dateKeyInTimezone(new Date(), "Asia/Karachi");
    void (async () => {
      const { error } = await supabase.from("progress_snapshots").upsert({
        user_id: userId,
        snapshot_date: snapshotDate,
        total_tasks: currentTasks.length,
        completed_tasks: currentTasks.filter((task) => task.done).length,
      }, { onConflict: "user_id,snapshot_date" });
      if (error) {
        setSaveNotice(`Could not save progress history: ${error.message}`);
        return;
      }
      const result = await supabase.from("progress_snapshots")
        .select("snapshot_date,total_tasks,completed_tasks")
        .eq("user_id", userId)
        .order("snapshot_date", { ascending: false })
        .limit(14);
      if (result.error) {
        setSaveNotice(`Could not load progress history: ${result.error.message}`);
        return;
      }
      setProgressHistory((result.data ?? []).reverse());
    })();
  }, [tasks, dataMode, supabase, userId]);

  useEffect(() => {
    if (dataMode !== "cloud") return;
    let active = true;
    void fetch("/api/google/status", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as GoogleStatus & { error?: string };
        if (!active) return;
        if (response.ok) setGoogleStatus(result);
        else setGoogleNotice(result.error ?? "Could not load Google connection status.");
      })
      .catch(() => { if (active) setGoogleNotice("Could not reach Google connection status."); });
    return () => { active = false; };
  }, [dataMode, userId, reloadCounter]);

  useEffect(() => {
    const result = new URL(window.location.href).searchParams.get("google");
    if (!result) return;
    setScreen("Settings");
    setGoogleNotice(result === "connected" ? "Google account connected. Run sync to import your classes." : `Google connection did not finish (${result}).`);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(themeStorageKey, JSON.stringify(theme));
    if (dataMode === "local") {
      window.localStorage.setItem(blocksStorageKey, JSON.stringify(blocks));
      window.localStorage.setItem(tasksStorageKey, JSON.stringify(tasks));
      window.localStorage.setItem(coursesStorageKey, JSON.stringify(courses));
    }
    document.documentElement.dataset.theme = theme;
  }, [tasks, courses, blocks, theme, hydrated, dataMode]);

  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const approvedTasks = tasks.filter((task) => !task.needsReview);
  const completed = approvedTasks.filter((task) => task.done).length;
  const progress = approvedTasks.length ? Math.round((completed / approvedTasks.length) * 100) : 0;
  const pending = approvedTasks.length - completed;
  const activeCourses = courses.filter((course) => !course.archived);
  const reviewTasks = tasks.filter((task) => task.needsReview);
  const getCourseName = (courseId: string | null) => courses.find((course) => course.id === courseId)?.name ?? "No course";
  const currentWeek = useMemo(() => {
    const start = startOfWeek(new Date());
    start.setDate(start.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [weekOffset]);
  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const courseName = (courseId: string | null) => courses.find((course) => course.id === courseId)?.name ?? "No course";
    return tasks
      .filter((task) => taskFilter === "All" || (taskFilter === "Pending" ? !task.done : task.done))
      .filter((task) => courseFilter === "All courses" || task.courseId === courseFilter)
      .filter((task) => !needle || `${task.title} ${courseName(task.courseId)} ${task.type} ${task.notes}`.toLowerCase().includes(needle))
      .sort((a, b) => (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31"));
  }, [tasks, courses, taskFilter, courseFilter, search]);

  function openTask(task?: Task) {
    setEditingTask(task ?? null);
    setFormTitle(task?.title ?? "");
    setFormCourse(task?.courseId ?? "");
    setFormType(task?.type ?? "Assignment");
    setFormDue(task?.due ?? "");
    setFormNotes(task?.notes ?? "");
    setModalOpen(true);
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    const title = formTitle.trim();
    if (!title) return;
    const values = {
      title,
      courseId: formCourse || null,
      type: formType,
      due: formDue,
      notes: formNotes.trim(),
    };
    if (dataMode === "cloud" && supabase && userId) {
      const row = {
        user_id: userId,
        title: values.title,
        course_id: values.courseId,
        task_type: taskTypeToDatabase[values.type],
        due_at: values.due ? `${values.due}T23:59:00+05:00` : null,
        due_date_explicit: Boolean(values.due),
        description: editingTask?.description || null,
        status: editingTask?.needsReview ? "pending_review" : editingTask?.done ? "completed" : "approved",
        completed_at: editingTask?.done ? new Date().toISOString() : null,
        user_notes: values.notes || null,
        updated_at: new Date().toISOString(),
      };
      if (editingTask) {
        const result = await supabase.from("tasks").update(row).eq("id", editingTask.id).eq("user_id", userId).select("id").maybeSingle();
        if (result.error) {
          setSaveNotice(`Could not save task: ${result.error.message}`);
          return;
        }
        if (!result.data) {
          setSaveNotice("Could not save task: it may have been removed or you no longer have access.");
          return;
        }
        setTasks((current) => current.map((task) => task.id === editingTask.id ? { ...task, ...values } : task));
      } else {
        const result = await supabase.from("tasks").insert(row).select("id").single();
        if (result.error) {
          setSaveNotice(`Could not save task: ${result.error.message}`);
          return;
        }
        setTasks((current) => [...current, { id: result.data.id, sourceId: null, ...values, done: false, needsReview: false, description: "" }]);
      }
    } else {
      const localTask: Task = {
        id: editingTask?.id ?? crypto.randomUUID(),
        sourceId: editingTask?.sourceId ?? null,
        ...values,
        done: editingTask?.done ?? false,
        needsReview: editingTask?.needsReview ?? false,
        description: editingTask?.description ?? "",
      };
      setTasks((current) => editingTask
        ? current.map((task) => task.id === editingTask.id ? localTask : task)
        : [...current, localTask]);
    }
    setModalOpen(false);
    setSaveNotice(dataMode === "cloud" ? (editingTask ? "Task updated." : "Task added.") : "Task saved on this device.");
    window.setTimeout(() => setSaveNotice(""), 2800);
  }

  async function toggleTask(taskId: string, done: boolean) {
    if (tasks.find((task) => task.id === taskId)?.needsReview) {
      setSaveNotice("Review this imported suggestion before marking it complete.");
      return;
    }
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (dataMode === "cloud" && supabase && userId) {
      const result = await supabase.from("tasks").update({
        status: done ? "completed" : "approved",
        completed_at: done ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("user_id", userId).select("id").maybeSingle();
      if (result.error) {
        setSaveNotice(`Could not update task: ${result.error.message}`);
        return;
      }
      if (!result.data) {
        setSaveNotice("Could not update task: it may have been removed or you no longer have access.");
        return;
      }
    }

    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, done } : task));
    if (done) {
      setBuddyMood("Celebrating");
      setBuddyMessage("One more little win. Look at you go!");
    } else {
      setBuddyMood("Idle");
      setBuddyMessage("Task moved back to your list. You’ve got this.");
    }
  }

  async function reviewTask(taskId: string, approve: boolean) {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task?.needsReview || !supabase || dataMode !== "cloud" || !userId) return;
    const result = await supabase.from("tasks").update({
      status: approve ? "approved" : "dismissed",
      updated_at: new Date().toISOString(),
    }).eq("id", taskId).eq("user_id", userId).eq("status", "pending_review").select("id").maybeSingle();
    if (result.error) {
      setSaveNotice(`Could not update review item: ${result.error.message}`);
      return;
    }
    if (!result.data) {
      setSaveNotice("This review item was already handled or is no longer available.");
      return;
    }
    setTasks((current) => approve
      ? current.map((entry) => entry.id === taskId ? { ...entry, needsReview: false } : entry)
      : current.filter((entry) => entry.id !== taskId));
    setSaveNotice(approve ? "Suggestion approved and added to your tasks." : "Suggestion dismissed.");
  }

  function openCourse(course?: Course) {
    setEditingCourse(course ?? null);
    setCourseName(course?.name ?? "");
    setCourseCode(course?.code ?? "");
    setCourseSection(course?.section ?? "");
    setCourseInstructor(course?.instructor ?? "");
    setCourseModalOpen(true);
  }

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    const name = courseName.trim();
    if (!name) return;
    const values = {
      name,
      course_code: courseCode.trim() || null,
      section: courseSection.trim() || null,
      instructor: courseInstructor.trim() || null,
      updated_at: new Date().toISOString(),
    };
    let savedCourse: Course;
    if (dataMode === "cloud" && supabase && userId) {
      const result = editingCourse
        ? await supabase.from("courses").update(values).eq("id", editingCourse.id).eq("user_id", userId).select("id,name,course_code,section,instructor,origin,is_archived").single()
        : await supabase.from("courses").insert({ ...values, user_id: userId, origin: "custom", google_course_id: null, is_archived: false }).select("id,name,course_code,section,instructor,origin,is_archived").single();
      if (result.error) {
        setSaveNotice(`Could not save course: ${result.error.message}`);
        return;
      }
      savedCourse = {
        id: result.data.id,
        name: result.data.name,
        code: result.data.course_code ?? "",
        section: result.data.section ?? "",
        instructor: result.data.instructor ?? "",
        origin: result.data.origin === "google_classroom" ? "google_classroom" : "custom",
        archived: result.data.is_archived,
      };
    } else {
      savedCourse = {
        id: editingCourse?.id ?? crypto.randomUUID(),
        name,
        code: courseCode.trim(),
        section: courseSection.trim(),
        instructor: courseInstructor.trim(),
        origin: editingCourse?.origin ?? "custom",
        archived: editingCourse?.archived ?? false,
      };
    }
    setCourses((current) => editingCourse
      ? current.map((course) => course.id === editingCourse.id ? savedCourse : course)
      : [...current, savedCourse]);
    setCourseModalOpen(false);
    setSaveNotice(dataMode === "cloud" ? "Course saved." : "Course saved on this device.");
    window.setTimeout(() => setSaveNotice(""), 2800);
  }

  async function archiveCourse(course: Course) {
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (dataMode === "cloud" && supabase && userId) {
      const result = await supabase.from("courses").update({ is_archived: !course.archived, updated_at: new Date().toISOString() }).eq("id", course.id).eq("user_id", userId).select("id").maybeSingle();
      if (result.error) {
        setSaveNotice(`Could not update course: ${result.error.message}`);
        return;
      }
      if (!result.data) {
        setSaveNotice("Could not update course: it may have been removed or you no longer have access.");
        return;
      }
    }
    setCourses((current) => current.map((entry) => entry.id === course.id ? { ...entry, archived: !entry.archived } : entry));
  }

  async function deleteCourse(course: Course) {
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (course.origin !== "custom") {
      setSaveNotice("Classroom courses are archived, not deleted, so linked tasks are preserved.");
      return;
    }
    if (!window.confirm(`Delete "${course.name}"? Linked tasks will be kept without a course.`)) return;
    if (dataMode === "cloud" && supabase && userId) {
      const result = await supabase.from("courses").delete().eq("id", course.id).eq("user_id", userId).select("id").maybeSingle();
      if (result.error) {
        setSaveNotice(`Could not delete course: ${result.error.message}`);
        return;
      }
      if (!result.data) {
        setSaveNotice("Could not delete course: it may have been removed or you no longer have access.");
        return;
      }
    }
    setCourses((current) => current.filter((entry) => entry.id !== course.id));
    setTasks((current) => current.map((task) => task.courseId === course.id ? { ...task, courseId: null } : task));
  }

  async function deleteTask(taskId: string) {
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (dataMode === "cloud" && supabase && userId) {
      const result = await supabase.from("tasks").update({
        status: "dismissed",
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("user_id", userId).select("id").maybeSingle();
      if (result.error) {
        setSaveNotice(`Could not delete task: ${result.error.message}`);
        return;
      }
      if (!result.data) {
        setSaveNotice("Could not delete task: it may have been removed or you no longer have access.");
        return;
      }
    }
    setTasks((current) => current.filter((task) => task.id !== taskId));
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setSaveNotice("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to enable accounts.");
      return;
    }
    setAuthBusy(true);
    const result = authMode === "sign-up"
      ? await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword })
      : await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
    setAuthBusy(false);
    if (result.error) {
      setSaveNotice(`Account ${authMode === "sign-up" ? "creation" : "sign-in"} failed: ${result.error.message}`);
    } else if (authMode === "sign-up" && !result.data.session) {
      setSaveNotice("Check your email to confirm your account, then sign in.");
    } else {
      setSaveNotice("Signed in.");
      setAuthPassword("");
    }
  }

  async function addStudyBlock() {
    const today = dateKey(new Date());
    const block = {
      id: crypto.randomUUID(),
      title: "Focused study session",
      date: today,
      start: "17:00",
      end: "18:00",
    };
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (supabase && dataMode === "cloud" && userId) {
      const result = await supabase.from("schedule_blocks").insert({
        id: block.id,
        user_id: userId,
        title: block.title,
        block_type: "study",
        start_at: `${today}T${block.start}:00+05:00`,
        end_at: `${today}T${block.end}:00+05:00`,
        timezone: "Asia/Karachi",
      }).select("id").single();
      if (result.error) {
        setSaveNotice(`Could not save study block: ${result.error.message}`);
        return;
      }
      block.id = result.data.id;
    }
    setBlocks((current) => [...current, block]);
    setSaveNotice("A one-hour study block was added for today.");
    window.setTimeout(() => setSaveNotice(""), 2800);
  }

  async function removeStudyBlock(id: string) {
    if (supabase && dataMode !== "cloud") {
      setSaveNotice("Sign in and load your StudyFlow workspace before changing account data.");
      return;
    }
    if (supabase && dataMode === "cloud" && userId) {
      const result = await supabase.from("schedule_blocks").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).eq("is_deleted", false).select("id").maybeSingle();
      if (result.error) {
        setSaveNotice(`Could not remove study block: ${result.error.message}`);
        return;
      }
      if (!result.data) {
        setSaveNotice("Could not remove study block: it may have been removed or you no longer have access.");
        return;
      }
    }
    setBlocks((current) => current.filter((block) => block.id !== id));
  }

  async function syncGoogle() {
    setGoogleBusy(true);
    setGoogleNotice("");
    try {
      const response = await fetch("/api/google/sync", { method: "POST" });
      const result = await response.json() as { courses?: number; announcements?: number; coursework?: number; gmail?: number; aiSuggestions?: number; warning?: string; error?: string };
      if (!response.ok) {
        setGoogleNotice(result.error ?? "Google sync failed.");
        return;
      }
      setGoogleNotice(`Sync complete: ${result.courses ?? 0} courses, ${result.announcements ?? 0} announcements, ${result.coursework ?? 0} coursework tasks, ${result.gmail ?? 0} Gmail messages, and ${result.aiSuggestions ?? 0} AI suggestions.${result.warning ? ` Warning: ${result.warning}` : ""}`);
      setReloadCounter((value) => value + 1);
    } catch {
      setGoogleNotice("Could not reach the Google sync service. Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function syncCalendar() {
    setGoogleBusy(true);
    setGoogleNotice("");
    try {
      const response = await fetch("/api/google/calendar/sync", { method: "POST" });
      const result = await response.json() as { synced?: number; error?: string };
      setGoogleNotice(response.ok ? `${result.synced ?? 0} approved planner items synchronized to Google Calendar.` : result.error ?? "Calendar sync failed.");
    } catch {
      setGoogleNotice("Could not reach Google Calendar. Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function loadGoogleCalendars() {
    setGoogleBusy(true);
    setGoogleNotice("");
    try {
      const response = await fetch("/api/google/calendars", { cache: "no-store" });
      const result = await response.json() as { calendars?: GoogleCalendar[]; selectedCalendarId?: string; error?: string };
      if (!response.ok) {
        setGoogleNotice(result.error ?? "Could not load Google calendars.");
        return;
      }
      setGoogleCalendars(result.calendars ?? []);
      setSelectedCalendarId(result.selectedCalendarId ?? "");
    } catch {
      setGoogleNotice("Could not reach Google Calendar. Please try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function saveGoogleCalendar(action: "create" | "select") {
    setGoogleBusy(true);
    setGoogleNotice("");
    try {
      const response = await fetch("/api/google/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "create" ? { action } : { action, calendarId: selectedCalendarId }),
      });
      const result = await response.json() as { selectedCalendarId?: string; error?: string };
      if (!response.ok) {
        setGoogleNotice(result.error ?? "Could not save the study calendar.");
        return;
      }
      setGoogleStatus((status) => ({ ...status, calendarSelected: true }));
      setSelectedCalendarId(result.selectedCalendarId ?? "");
      setGoogleNotice(action === "create" ? "Dedicated StudyFlow calendar created." : "Study calendar selected.");
    } catch {
      setGoogleNotice("Could not reach the Google Calendar service.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect Google and revoke its StudyFlow access? Imported courses and tasks will remain.")) return;
    setGoogleBusy(true);
    setGoogleNotice("");
    try {
      const response = await fetch("/api/google/disconnect", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setGoogleNotice(result.error ?? "Could not disconnect Google.");
        return;
      }
      setGoogleStatus({ connected: false, configured: false, email: null, lastSyncAt: null, calendarSelected: false });
      setGoogleCalendars([]);
      setGoogleNotice("Google access revoked and disconnected. Imported data was kept.");
    } catch {
      setGoogleNotice("Could not reach the Google disconnect service.");
    } finally {
      setGoogleBusy(false);
    }
  }

  async function askBuddy(prompt: string) {
    if (!supabase || dataMode !== "cloud" || !userId) {
      setBuddyMood("Needs Attention");
      setBuddyMessage("Dot Buddy needs a signed-in Supabase account and configured AI service. No task was changed.");
      return;
    }
    setBuddyBusy(true);
    setBuddyMood("Thinking");
    setBuddyMessage("Checking your planner and preparing a response…");
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const result = await response.json() as { reply?: string; error?: string };
      if (!response.ok || !result.reply) {
        setBuddyMood("Needs Attention");
        setBuddyMessage(result.error ?? "Dot Buddy could not respond. Please try again.");
        return;
      }
      setBuddyMood("Idle");
      setBuddyMessage(result.reply);
    } catch {
      setBuddyMood("Needs Attention");
      setBuddyMessage("Dot Buddy could not reach the planner service. Please check your connection and try again.");
    } finally {
      setBuddyBusy(false);
    }
  }

  const weekLabel = `${shortDate(currentWeek[0])} – ${shortDate(currentWeek[6])}`;
  const upcoming = tasks.filter((task) => !task.needsReview && !task.done && task.due).slice().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);

  return (
    <main className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <button className="brand-lockup" onClick={() => setScreen("Dashboard")} aria-label="StudyFlow dashboard">
          <StarMark /><span className="brand-name">Study<span>Flow</span><small>Plan · Learn · Achieve</small></span>
        </button>
        <div className="side-caption">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button key={item.name} className={`nav-item${screen === item.name ? " active" : ""}`} aria-label={item.name} onClick={() => { setScreen(item.name); if (window.matchMedia("(max-width: 700px)").matches) setCollapsed(false); }} title={collapsed ? item.name : undefined}>
              <span className="nav-icon">{item.icon}</span><span className="nav-label">{item.name}</span>
              {item.name === "Tasks" && pending > 0 && <span className="nav-count">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-buddy">
          <div className="buddy-orb" aria-hidden="true"><span>✦</span></div>
          <strong>Small steps,</strong><span>create big results.</span>
          <div className="buddy-stars">✦ · · · ✦</div>
        </div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? "›" : "‹"}<span className="nav-label">Collapse menu</span></button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setCollapsed((value) => !value)} aria-label="Toggle navigation">☰</button>
          <div className="search-wrap"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="Search tasks and courses" placeholder="Search courses, tasks..." value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && search.trim()) setScreen("Tasks"); }} /><kbd>Ctrl K</kbd></div>
          <div className="topbar-actions">
            <button className="connection-chip" onClick={() => setScreen("Settings")} title="Google Classroom connection status">
              <span className="classroom-mark">▣</span><span><strong>Google Classroom</strong><small><i className="status-dot" /> {googleStatus.connected ? "Connected" : "Disconnected"}</small></span><span>⌄</span>
            </button>
            <button className="icon-button" aria-label="Notifications" onClick={() => { setBuddyMood("Needs Attention"); setBuddyMessage(pending ? `You have ${pending} pending task${pending === 1 ? "" : "s"} to review.` : "You're all caught up. Add a task whenever you’re ready."); }}>♧{pending > 0 && <i />}</button>
            <button className="profile-chip" onClick={() => setScreen("Settings")}><span className="avatar">S</span><span><strong>My workspace</strong><small>Personal planner</small></span><span>⌄</span></button>
          </div>
        </header>

        <div className="content">
          {saveNotice && <div className="toast" role="status">{saveNotice}</div>}
          {dataMode === "local" && <div className="notice"><strong>Local device mode:</strong> add Supabase settings to enable account sign-in and synced storage. Courses and tasks currently stay in this browser.</div>}
          {dataMode === "error" && <div className="notice error-notice" role="alert"><strong>Planner data could not be loaded.</strong> {dataError} Check your Supabase schema and connection before editing cloud data.</div>}
          {dataMode === "signed-out" && <section className="notice auth-notice"><strong>Sign in to your StudyFlow workspace.</strong> Use your account to load private courses and tasks. <button className="text-link" onClick={() => setScreen("Settings")}>Sign in or create an account →</button></section>}
          {screen === "Dashboard" && <Dashboard
            tasks={tasks} courses={activeCourses} courseName={getCourseName} blocks={blocks} completed={completed} pending={pending} progress={progress} upcoming={upcoming}
            currentWeek={currentWeek} weekLabel={weekLabel} weekOffset={weekOffset} setWeekOffset={setWeekOffset}
            openTask={openTask} toggleTask={toggleTask} reviewTask={reviewTask} reviewTasks={reviewTasks} setScreen={setScreen} askBuddy={askBuddy} buddyMood={buddyMood} buddyMessage={buddyMessage} buddyPrompt={buddyPrompt} setBuddyPrompt={setBuddyPrompt} buddyBusy={buddyBusy}
            setTaskFilter={setTaskFilter} setCourseFilter={setCourseFilter}
          />}
          {screen === "Calendar" && <CalendarScreen tasks={tasks} courseName={getCourseName} blocks={blocks} currentWeek={currentWeek} weekLabel={weekLabel} weekOffset={weekOffset} setWeekOffset={setWeekOffset} openTask={openTask} />}
          {screen === "Courses" && <CoursesScreen courses={courses} tasks={tasks} googleConnected={googleStatus.connected} openCourse={openCourse} archiveCourse={archiveCourse} deleteCourse={deleteCourse} setCourseFilter={setCourseFilter} setScreen={setScreen} />}
          {screen === "Tasks" && <TasksScreen tasks={filteredTasks} courses={activeCourses} courseName={getCourseName} filter={taskFilter} setFilter={setTaskFilter} courseFilter={courseFilter} setCourseFilter={setCourseFilter} openTask={openTask} toggleTask={toggleTask} deleteTask={deleteTask} />}
          {screen === "Announcements" && <AnnouncementsScreen sources={sources} courses={courses} connected={googleStatus.connected} busy={googleBusy} syncGoogle={syncGoogle} setScreen={setScreen} />}
          {screen === "Study Planner" && <StudyPlannerScreen blocks={blocks} addStudyBlock={addStudyBlock} removeBlock={removeStudyBlock} />}
          {screen === "Progress" && <ProgressScreen tasks={tasks} courses={activeCourses} completed={completed} pending={pending} progress={progress} history={progressHistory} />}
          {screen === "Settings" && <SettingsScreen theme={theme} setTheme={setTheme} setScreen={setScreen} dataMode={dataMode} supabaseAvailable={Boolean(supabase)} userEmail={userEmail} authEmail={authEmail} setAuthEmail={setAuthEmail} authPassword={authPassword} setAuthPassword={setAuthPassword} authMode={authMode} setAuthMode={setAuthMode} authBusy={authBusy} submitAuth={submitAuth} signOut={async () => { if (supabase) await supabase.auth.signOut(); }} googleStatus={googleStatus} googleBusy={googleBusy} googleNotice={googleNotice} googleCalendars={googleCalendars} selectedCalendarId={selectedCalendarId} setSelectedCalendarId={setSelectedCalendarId} connectGoogle={() => { window.location.href = "/api/google/connect"; }} syncGoogle={syncGoogle} disconnectGoogle={disconnectGoogle} loadGoogleCalendars={loadGoogleCalendars} saveGoogleCalendar={saveGoogleCalendar} syncCalendar={syncCalendar} />}
          <footer className="footer"><span><StarMark small /> StudyFlow <span className="footer-muted">· Plan · Learn · Achieve</span></span><span>Designed for students, by students.</span></footer>
        </div>
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}>
        <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
          <div className="panel-heading"><div><div className="eyebrow">YOUR STUDY FLOW</div><h2 id="task-modal-title">{editingTask ? "Edit task" : "Add a task"}</h2></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close">×</button></div>
          <form onSubmit={saveTask} className="task-form">
            <label>Task or lecture topic<input autoFocus required maxLength={240} value={formTitle} onChange={(event) => setFormTitle(event.target.value)} placeholder="e.g. Read chapter 4" /></label>
            <div className="form-row">
              <label>Course<select value={formCourse} onChange={(event) => setFormCourse(event.target.value)}><option value="">No course</option>{activeCourses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}</select></label>
              <label>Type<select value={formType} onChange={(event) => setFormType(event.target.value as TaskType)}>{taskTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            </div>
            <label>Deadline<input type="date" value={formDue} onChange={(event) => setFormDue(event.target.value)} /></label>
            <label>Notes or subtasks<textarea rows={3} value={formNotes} onChange={(event) => setFormNotes(event.target.value)} placeholder="Add details, chapters, or submission requirements..." /></label>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModalOpen(false)}>Cancel</button><button className="button button-primary" type="submit">{editingTask ? "Save changes" : "Add to my list"} <span>→</span></button></div>
          </form>
        </section>
      </div>}
      {courseModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCourseModalOpen(false); }}>
        <section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="course-modal-title">
          <div className="panel-heading"><div><div className="eyebrow">YOUR COURSES</div><h2 id="course-modal-title">{editingCourse ? "Edit course" : "Add a course"}</h2></div><button className="icon-button" onClick={() => setCourseModalOpen(false)} aria-label="Close">×</button></div>
          <form className="task-form" onSubmit={saveCourse}>
            <label>Course name<input autoFocus required maxLength={120} value={courseName} onChange={(event) => setCourseName(event.target.value)} placeholder="e.g. Introduction to Biology" /></label>
            <div className="form-row"><label>Course code (optional)<input maxLength={32} value={courseCode} onChange={(event) => setCourseCode(event.target.value)} placeholder="e.g. BIO 101" /></label><label>Section (optional)<input maxLength={80} value={courseSection} onChange={(event) => setCourseSection(event.target.value)} placeholder="e.g. Section A" /></label></div>
            <label>Instructor (optional)<input maxLength={120} value={courseInstructor} onChange={(event) => setCourseInstructor(event.target.value)} placeholder="Instructor name" /></label>
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setCourseModalOpen(false)}>Cancel</button><button className="button button-primary" type="submit">{editingCourse ? "Save course" : "Add course"} <span>→</span></button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Dashboard(props: {
  tasks: Task[]; courses: Course[]; courseName: (id: string | null) => string; blocks: StudyBlock[]; completed: number; pending: number; progress: number; upcoming: Task[];
  reviewTasks: Task[]; reviewTask: (id: string, approve: boolean) => void;
  currentWeek: Date[]; weekLabel: string; weekOffset: number; setWeekOffset: (change: number | ((old: number) => number)) => void;
  openTask: (task?: Task) => void; toggleTask: (id: string, done: boolean) => void; setScreen: (screen: Screen) => void;
  askBuddy: (prompt: string) => Promise<void>; buddyMood: BuddyMood; buddyMessage: string;
  buddyPrompt: string; setBuddyPrompt: (prompt: string) => void; buddyBusy: boolean;
  setTaskFilter: (filter: "All" | "Pending" | "Completed") => void; setCourseFilter: (course: string) => void;
}) {
  const { tasks, courses, courseName, blocks, completed, pending, progress, upcoming, reviewTasks, reviewTask, currentWeek, weekLabel, weekOffset, setWeekOffset, openTask, toggleTask, setScreen, askBuddy, buddyMood, buddyMessage, buddyPrompt, setBuddyPrompt, buddyBusy, setTaskFilter, setCourseFilter } = props;
  const today = new Date();
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 18 ? "Good afternoon" : "Good evening";
  const todayLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(today).toUpperCase();
  const coursesWithTasks = courses.map((course, index) => {
    const courseTasks = tasks.filter((task) => task.courseId === course.id && !task.needsReview);
    const courseDone = courseTasks.filter((task) => task.done).length;
    return { ...course, count: courseTasks.length, value: courseTasks.length ? Math.round((courseDone / courseTasks.length) * 100) : 0, color: ["pink", "blue", "lavender", "rose", "violet", "mint"][index % 6] };
  });
  const calendarItems = [
    ...tasks.filter((task) => task.due && !task.needsReview).map((task) => ({ id: task.id, title: task.title, date: task.due, kind: "task" })),
    ...blocks.map((block) => ({ id: block.id, title: block.title, date: block.date, kind: "study" })),
  ];

  return <>
    <div className="welcome-row">
      <div><div className="eyebrow">{todayLabel}</div><h1>{greeting}, <span className="gradient-text">Sawa!</span> <span className="sparkle">✦</span></h1><p>Keep going. Your effort today is building the future you want.</p></div>
      <button className="button button-primary add-task-top" onClick={() => openTask()}><span>＋</span> Add a task</button>
    </div>
    <section className="hero-grid">
      <article className="glass-card weekly-progress">
        <div className="card-title"><div><span className="eyebrow">A LITTLE PROGRESS ADDS UP</span><h2>Weekly progress</h2></div><span className="card-spark">✦</span></div>
        <div className="progress-content"><ProgressRing value={progress} /><div className="stat-grid">
          <div className="mini-stat"><span className="stat-icon done-icon">✓</span><span><strong>{completed}</strong><small>Done</small></span></div>
          <div className="mini-stat"><span className="stat-icon pending-icon">◷</span><span><strong>{pending}</strong><small>In progress</small></span></div>
          <div className="mini-stat"><span className="stat-icon deadline-icon">⌁</span><span><strong>{upcoming.length}</strong><small>Deadlines</small></span></div>
        </div></div>
        <div className="progress-caption">{tasks.length ? `${completed} of ${tasks.length} tasks completed` : "Add tasks to see your real progress here."}</div>
      </article>
      <article className="glass-card week-card">
        <div className="card-title"><div><span className="eyebrow">YOUR WEEK AT A GLANCE</span><h2>Weekly calendar</h2></div><div className="calendar-controls"><button aria-label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>‹</button><span>{weekLabel}</span><button aria-label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>›</button></div></div>
        <div className="week-days">{currentWeek.map((day) => {
          const key = dateKey(day);
          const dayItems = calendarItems.filter((item) => item.date === key);
          return <button className={`week-day${dateKey(today) === key ? " today" : ""}`} key={key} onClick={() => setScreen("Calendar")}><span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(day)}</span><strong>{day.getDate()}</strong><i className={dayItems.length ? "has-event" : ""} />{dayItems.length > 0 && <small>{dayItems.length} item{dayItems.length === 1 ? "" : "s"}</small>}</button>;
        })}</div>
        <div className="calendar-empty-note"><span>✦</span> Your upcoming deadlines and study blocks appear here.</div>
      </article>
    </section>
    <section className="main-grid">
      <div className="main-column">
        <div className="content-grid">
          <section className="glass-card courses-card">
            <div className="card-title"><div><span className="eyebrow">YOUR LEARNING PATH</span><h2>Your courses</h2></div><button className="text-link" onClick={() => setScreen("Courses")}>View all <span>→</span></button></div>
            {coursesWithTasks.length ? <div className="course-progress-list">{coursesWithTasks.slice(0, 5).map((course) => <button className="course-progress-row" key={course.id} onClick={() => { setCourseFilter(course.id); setTaskFilter("All"); setScreen("Tasks"); }}>
              <span className={`course-glyph ${course.color}`}>{course.name.slice(0, 1)}</span><span className="course-progress-info"><span className="course-name">{course.name}</span><span className="course-meter"><i style={{ width: `${course.value}%` }} /></span></span><span className="course-percent">{course.value}%</span>
            </button>)}</div> : <EmptyState icon="◇" title="No courses yet" text="Add a course manually, or connect Google Classroom when integration is available." />}
            {coursesWithTasks.length > 0 && <p className="subtle-note">Progress is calculated from your completed tasks.</p>}
          </section>
          <section className="glass-card deadlines-card">
            <div className="card-title"><div><span className="eyebrow">STAY AHEAD</span><h2>Upcoming deadlines</h2></div><button className="text-link" onClick={() => { setTaskFilter("Pending"); setScreen("Tasks"); }}>View all <span>→</span></button></div>
            {upcoming.length ? <div className="deadline-list">{upcoming.map((task) => <button className="deadline-row" key={task.id} onClick={() => openTask(task)}><span className="date-tile"><small>{readableDate(task.due).split(" ")[0]}</small><strong>{new Date(`${task.due}T12:00:00`).getDate()}</strong></span><span className="deadline-copy"><strong>{task.title}</strong><small>{courseName(task.courseId)}</small></span><span className="deadline-type">{task.type}</span></button>)}</div>
              : <EmptyState icon="✧" title="A little breathing room" text="No upcoming deadlines. Add a task with a due date to keep track." />}
          </section>
        </div>
        <div className="content-grid lower-grid">
          <section className="glass-card announcements-card">
            <div className="card-title"><div><span className="eyebrow">FROM YOUR CLASSROOM</span><h2>Announcements</h2></div><span className="tiny-status"><i className="status-dot" /> Not connected</span></div>
            <div className="connect-empty"><span className="empty-orbit">◉</span><div><strong>Bring your classes into the flow</strong><p>Connect Google Classroom to import announcements and coursework.</p><button className="text-link" onClick={() => setScreen("Settings")}>Set up connection <span>→</span></button></div></div>
          </section>
          <section className="glass-card todo-card">
            <div className="card-title"><div><span className="eyebrow">ONE THING AT A TIME</span><h2>To-do list</h2></div><button className="small-add" onClick={() => openTask()}>＋ Add</button></div>
            {tasks.length ? <div className="todo-list">{tasks.filter((task) => !task.done).slice(0, 4).map((task) => <div className="todo-row" key={task.id}><input aria-label={`Complete ${task.title}`} type="checkbox" checked={task.done} onChange={(event) => toggleTask(task.id, event.target.checked)} /><button className="todo-copy" onClick={() => openTask(task)}><strong>{task.title}</strong><small>{courseName(task.courseId)}{task.due ? ` · ${readableDate(task.due)}` : ""}</small></button><span className="todo-tag">{task.type}</span></div>)}
              {!pending && <EmptyState icon="✓" title="Everything is checked off" text="Add a task whenever something new comes up." />}</div>
              : <EmptyState icon="☷" title="Your list starts here" text="Add an assignment, lecture topic, or revision goal." />}
            {tasks.length > 4 && <button className="text-link todo-view-all" onClick={() => setScreen("Tasks")}>See all tasks <span>→</span></button>}
          </section>
          <section className="glass-card review-card">
            <div className="card-title"><div><span className="eyebrow">AI-ASSISTED, WITH YOUR APPROVAL</span><h2>Review queue</h2></div><span className="review-count">{reviewTasks.length}</span></div>
            {reviewTasks.length ? <div className="review-list">{reviewTasks.slice(0, 4).map((task) => <article className="review-item" key={task.id}><strong>{task.title}</strong><small>{courseName(task.courseId)} · {task.type}{task.due ? ` · ${readableDate(task.due)}` : " · No confirmed deadline"}</small>{task.description && <p>{task.description}</p>}<div><button className="button button-primary" onClick={() => reviewTask(task.id, true)}>Approve</button><button className="button button-quiet" onClick={() => reviewTask(task.id, false)}>Dismiss</button><button className="text-link" onClick={() => openTask(task)}>Edit</button></div></article>)}</div> : <div className="review-empty"><span>✦</span><strong>Nothing to review yet</strong><p>Imported coursework and clearly extracted announcement tasks appear here until you approve or dismiss them.</p><button className="text-link" onClick={() => setScreen("Announcements")}>View announcements <span>→</span></button></div>}
          </section>
        </div>
      </div>
      <aside className="right-column">
        <section className="buddy-card glass-card">
          <div className="buddy-speech">You have <strong>{pending} task{pending === 1 ? "" : "s"}</strong> on your list ✦</div>
          <div className={`buddy-character mood-${buddyMood.toLowerCase().replaceAll(" ", "-")}`} aria-label={`Dot Buddy: ${buddyMood}`}><span className="buddy-ear ear-left" /><span className="buddy-ear ear-right" /><span className="buddy-face"><i className="eye eye-left" /><i className="eye eye-right" /><i className="buddy-smile" /></span><span className="buddy-star">✦</span></div>
          <div className="buddy-panel"><span className="eyebrow">YOUR STUDY COMPANION</span><h2>Dot Buddy</h2><p className="buddy-message" role="status">{buddyMessage}</p>
            <div className="buddy-actions"><button disabled={buddyBusy} onClick={() => void askBuddy("Review my upcoming deadlines and suggest what I should prioritize. Do not change my planner.")}><span>◷</span> Check deadlines <i>→</i></button><button disabled={buddyBusy} onClick={() => void askBuddy("Suggest a study block based on my upcoming tasks. Do not add or change any schedule item.")}><span>▦</span> Suggest a study block <i>→</i></button><button disabled={buddyBusy} onClick={() => void askBuddy("Summarize the announcements available to me. If none have been imported, say so clearly.")}><span>✧</span> Explain announcements <i>→</i></button></div>
            <form className="buddy-input" onSubmit={(event) => { event.preventDefault(); const message = buddyPrompt.trim(); if (message) { setBuddyPrompt(""); void askBuddy(message); } }}>
              <label className="visually-hidden" htmlFor="buddy-prompt">Ask Dot Buddy a question</label>
              <input id="buddy-prompt" value={buddyPrompt} maxLength={500} onChange={(event) => setBuddyPrompt(event.target.value)} placeholder="Ask about your study plan..." disabled={buddyBusy} />
              <button className="button buddy-ask" type="submit" disabled={buddyBusy || !buddyPrompt.trim()}>{buddyBusy ? "Thinking…" : "Ask Dot Buddy"} <span>→</span></button>
            </form>
            <p className="buddy-disclosure">AI replies require a signed-in account and configured server-side AI service. Suggestions never change your schedule or tasks.</p>
          </div>
          <div className="buddy-mood"><span className="eyebrow">BUDDY MOOD</span><span className={`mood-pill mood-${buddyMood.toLowerCase().replaceAll(" ", "-")}`}>{buddyMood === "Celebrating" ? "✧" : buddyMood === "Thinking" ? "◌" : buddyMood === "Needs Attention" ? "!" : "✦"} {buddyMood}</span></div>
        </section>
        <section className="glass-card focus-card"><div className="card-title"><div><span className="eyebrow">A GENTLE REMINDER</span><h2>Make space to focus</h2></div></div><p>Small, steady study sessions can make a big difference.</p><button className="text-link" onClick={() => setScreen("Study Planner")}>Open study planner <span>→</span></button></section>
      </aside>
    </section>
  </>;
}

function EmptyState({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>;
}

function CalendarScreen({ tasks, courseName, blocks, currentWeek, weekLabel, weekOffset, setWeekOffset, openTask }: {
  tasks: Task[]; courseName: (id: string | null) => string; blocks: StudyBlock[]; currentWeek: Date[]; weekLabel: string; weekOffset: number; setWeekOffset: (change: number) => void; openTask: (task?: Task) => void;
}) {
  const items = [...tasks.filter((task) => task.due && !task.needsReview).map((task) => ({ id: task.id, title: task.title, date: task.due, label: courseName(task.courseId), type: task.type, task })), ...blocks.map((block) => ({ id: block.id, title: block.title, date: block.date, label: `${block.start}–${block.end}`, type: "Study block", task: undefined }))];
  return <><PageHeading eyebrow="YOUR TIME, YOUR RHYTHM" title="Calendar" description="A clear view of deadlines and study blocks you have added." action={<button className="button button-primary" onClick={() => openTask()}>＋ Add task</button>} />
    <section className="glass-card calendar-page"><div className="calendar-page-head"><div><span className="eyebrow">WEEK VIEW</span><h2>{weekLabel}</h2></div><div className="calendar-controls"><button aria-label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>‹</button><button className="today-button" onClick={() => setWeekOffset(0)}>Today</button><button aria-label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>›</button></div></div>
      <div className="calendar-full-grid">{currentWeek.map((day) => {
        const key = dateKey(day);
        const dayItems = items.filter((item) => item.date === key);
        return <article className={`calendar-full-day${dateKey(new Date()) === key ? " today" : ""}`} key={key}><div className="full-day-title"><span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(day)}</span><strong>{day.getDate()}</strong></div>{dayItems.length ? dayItems.map((item) => <button className={`calendar-event ${item.type === "Study block" ? "study-event" : ""}`} key={item.id} onClick={() => item.task && openTask(item.task)}><strong>{item.title}</strong><small>{item.label}</small></button>) : <span className="day-open">A little open space</span>}</article>;
      })}</div>
      <p className="subtle-note">Your classes will appear here after you connect a source or add a schedule block.</p>
    </section></>;
}

function CoursesScreen({ courses, tasks, googleConnected, openCourse, archiveCourse, deleteCourse, setCourseFilter, setScreen }: {
  courses: Course[]; tasks: Task[]; googleConnected: boolean; openCourse: (course?: Course) => void; archiveCourse: (course: Course) => void; deleteCourse: (course: Course) => void; setCourseFilter: (course: string) => void; setScreen: (screen: Screen) => void;
}) {
  const activeCourses = courses.filter((course) => !course.archived);
  return <><PageHeading eyebrow="LEARN AT YOUR OWN PACE" title="Your courses" description="Create and manage your courses. Course progress is calculated from tasks you complete." action={<button className="button button-primary" onClick={() => openCourse()}>＋ Add course</button>} />
    {courses.length ? <div className="course-page-grid">{courses.map((course, index) => {
      const courseTasks = tasks.filter((task) => task.courseId === course.id && !task.needsReview);
      const done = courseTasks.filter((task) => task.done).length;
      const percent = courseTasks.length ? Math.round(done / courseTasks.length * 100) : 0;
      return <article className={`glass-card course-page-card${course.archived ? " archived-course" : ""}`} key={course.id}><button className="course-page-main" onClick={() => { if (!course.archived) { setCourseFilter(course.id); setScreen("Tasks"); } }} disabled={course.archived}><div className={`course-glyph ${["pink", "blue", "lavender", "rose", "violet", "mint"][index % 6]}`}>{course.name.slice(0, 1)}</div><div className="course-page-copy"><span className="eyebrow">{course.origin === "custom" ? "PERSONAL COURSE" : "GOOGLE CLASSROOM"}{course.archived ? " · ARCHIVED" : ""}</span><h2>{course.name}</h2><p>{[course.code, course.section, course.instructor].filter(Boolean).join(" · ") || `${courseTasks.length} task${courseTasks.length === 1 ? "" : "s"} · ${done} completed`}</p><span className="course-meter"><i style={{ width: `${percent}%` }} /></span></div><strong className="course-percent">{percent}%</strong></button><div className="course-actions"><button className="text-link" onClick={() => openCourse(course)}>Edit</button><button className="text-link" onClick={() => archiveCourse(course)}>{course.archived ? "Restore" : "Archive"}</button>{course.origin === "custom" && <button className="text-link delete-course" onClick={() => deleteCourse(course)}>Delete</button>}</div></article>;
    })}</div> : <section className="glass-card course-empty"><EmptyState icon="◇" title="No courses yet" text={googleConnected ? "Run a Classroom sync to import courses, or add a course manually." : "Connect Google Classroom to import your courses, or add a course manually."} /><div className="course-empty-actions"><button className="button button-quiet" onClick={() => setScreen("Settings")}>{googleConnected ? "Sync Classroom courses" : "Classroom connection setup"}</button><button className="button button-primary" onClick={() => openCourse()}>Add course manually</button></div></section>}
    {activeCourses.length > 0 && <div className="glass-card setup-note"><span className="notice-icon">✦</span><div><strong>{googleConnected ? "Keep your Classroom courses current" : "Want your courses to arrive automatically?"}</strong><p>{googleConnected ? "Google Classroom is connected. Sync preserves your custom courses and existing task progress." : "Google Classroom is disconnected. Imported courses will be kept separate from your custom courses."}</p></div><button className="text-link" onClick={() => setScreen("Settings")}>{googleConnected ? "Sync settings →" : "Connection settings →"}</button></div>}
  </>;
}

function TasksScreen({ tasks, courses, courseName, filter, setFilter, courseFilter, setCourseFilter, openTask, toggleTask, deleteTask }: {
  tasks: Task[]; courses: Course[]; courseName: (id: string | null) => string; filter: "All" | "Pending" | "Completed"; setFilter: (filter: "All" | "Pending" | "Completed") => void; courseFilter: string;
  setCourseFilter: (course: string) => void; openTask: (task?: Task) => void; toggleTask: (id: string, done: boolean) => void; deleteTask: (id: string) => void;
}) {
  return <><PageHeading eyebrow="YOUR NEXT SMALL STEP" title="Tasks" description="Assignments, lecture topics, labs, and revision—all in one manageable list." action={<button className="button button-primary" onClick={() => openTask()}>＋ Add task</button>} />
    <section className="glass-card task-page-card"><div className="task-toolbar"><div className="filter-tabs">{(["All", "Pending", "Completed"] as const).map((value) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value}</button>)}</div><select aria-label="Filter tasks by course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="All courses">All courses</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></div>
      {tasks.length ? <div className="task-page-list">{tasks.map((task) => <article className={`task-page-row${task.done ? " is-done" : ""}`} key={task.id}><input type="checkbox" aria-label={`Complete ${task.title}`} checked={task.done} disabled={task.needsReview} onChange={(event) => toggleTask(task.id, event.target.checked)} /><button className="task-page-copy" onClick={() => openTask(task)}><strong>{task.title}{task.needsReview && <span className="review-badge">Needs review</span>}</strong><span>{courseName(task.courseId)} <i>·</i> {task.type}{task.due ? <><i>·</i> Due {readableDate(task.due)}</> : null}</span>{task.notes && <small>{task.notes}</small>}</button><button className="icon-button edit-task" onClick={() => openTask(task)} aria-label={`Edit ${task.title}`}>✎</button><button className="icon-button delete-task" onClick={() => deleteTask(task.id)} aria-label={`Delete ${task.title}`}>×</button></article>)}</div> : <EmptyState icon="☷" title={filter === "Completed" ? "No completed tasks yet" : "Your task list is clear"} text="Try another filter, or add a task to start planning your week." />}
    </section>
  </>;
}

function AnnouncementsScreen({ sources, courses, connected, busy, syncGoogle, setScreen }: {
  sources: ImportedSource[]; courses: Course[]; connected: boolean; busy: boolean; syncGoogle: () => void; setScreen: (screen: Screen) => void;
}) {
  const courseName = (courseId: string | null) => courses.find((course) => course.id === courseId)?.name ?? "";
  return <><PageHeading eyebrow="STAY IN THE LOOP" title="Announcements" description="Imported Google Classroom announcements and relevant Gmail notifications." action={connected ? <button className="button button-primary" disabled={busy} onClick={syncGoogle}>{busy ? "Syncing…" : "↻ Sync now"}</button> : undefined} />
    {!connected && <section className="glass-card integration-empty"><div className="empty-orbit large-orbit">◉</div><span className="connection-label"><i className="status-dot" /> GOOGLE CLASSROOM · DISCONNECTED</span><h2>Your classroom, when you’re ready</h2><p>Connect Google in Settings to import your courses, announcements, coursework, and relevant email notifications.</p><button className="button button-primary" onClick={() => setScreen("Settings")}>View connection setup <span>→</span></button></section>}
    {connected && (sources.length ? <section className="glass-card announcement-list">{sources.map((source) => <article className="announcement-item" key={source.id}><div className="card-title"><div><span className="eyebrow">{source.provider === "gmail" ? "GMAIL NOTIFICATION" : "GOOGLE CLASSROOM"}{courseName(source.courseId) ? ` · ${courseName(source.courseId)}` : ""}</span><h2>{source.title}</h2></div><time>{source.publishedAt ? readableDate(source.publishedAt.slice(0, 10)) : "Imported"}</time></div><p>{source.body || "No announcement text was provided."}</p>{source.sourceUrl && <a className="text-link" href={source.sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a>}</article>)}</section> : <section className="glass-card integration-empty"><span className="connection-label"><i className="status-dot" /> GOOGLE CONNECTED</span><h2>No imported updates yet</h2><p>Run a sync to fetch announcements and coursework from the connected Google account.</p><button className="button button-primary" disabled={busy} onClick={syncGoogle}>{busy ? "Syncing…" : "Sync now"}</button></section>)}
    <section className="glass-card review-explainer"><span className="review-symbol">✧</span><div><span className="eyebrow">AI REVIEW QUEUE</span><h2>You stay in control</h2><p>Coursework and extracted tasks remain pending until you approve them. Unclear dates are not invented, and no Calendar events are created before approval.</p><button className="text-link" onClick={() => setScreen("Dashboard")}>Review suggestions on your dashboard →</button></div></section>
  </>;
}

function StudyPlannerScreen({ blocks, addStudyBlock, removeBlock }: { blocks: StudyBlock[]; addStudyBlock: () => void; removeBlock: (id: string) => void }) {
  return <><PageHeading eyebrow="MAKE ROOM FOR DEEP WORK" title="Study planner" description="Add gentle focus blocks around your classes and deadlines." action={<button className="button button-primary" onClick={addStudyBlock}>＋ Plan a study block</button>} />
    <div className="study-planner-layout"><section className="glass-card study-goal-card"><span className="eyebrow">WEEKLY INTENTION</span><h2>Build a rhythm that works for you.</h2><p>Start with one focused session. You can adjust your routine as the semester moves along.</p><div className="study-goal-visual"><span>✦</span><div><strong>{blocks.length}</strong><small>study block{blocks.length === 1 ? "" : "s"} planned</small></div></div><button className="button button-primary" onClick={addStudyBlock}>Add a one-hour block <span>→</span></button></section>
      <section className="glass-card planned-blocks"><div className="card-title"><div><span className="eyebrow">YOUR PLAN</span><h2>Study sessions</h2></div><span className="review-count">{blocks.length}</span></div>{blocks.length ? <div className="task-page-list">{blocks.slice().sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`)).map((block) => <article className="task-page-row" key={block.id}><span className="study-block-icon">◷</span><div className="task-page-copy"><strong>{block.title}</strong><span>{readableDate(block.date)} · {block.start}–{block.end}</span></div><button className="icon-button delete-task" onClick={() => removeBlock(block.id)} aria-label="Remove study block">×</button></article>)}</div> : <EmptyState icon="◷" title="No study sessions planned" text="Your study blocks will appear here. They’re saved on this device." />}</section></div>
    <p className="subtle-note">Study blocks are saved to your account when signed in, or to this browser in local mode. Calendar events are written only after you approve a task and choose to sync.</p>
  </>;
}

function ProgressScreen({ tasks, courses, completed, pending, progress, history }: { tasks: Task[]; courses: Course[]; completed: number; pending: number; progress: number; history: ProgressSnapshot[] }) {
  const courseData = courses.map((course) => {
    const entries = tasks.filter((task) => task.courseId === course.id && !task.needsReview);
    const done = entries.filter((task) => task.done).length;
    return { course: course.name, total: entries.length, done, value: entries.length ? Math.round(done / entries.length * 100) : 0 };
  });
  return <><PageHeading eyebrow="NOTICE HOW FAR YOU’VE COME" title="Progress" description="A real-time snapshot plus daily history saved to your account." />
    <div className="progress-overview"><section className="glass-card progress-summary"><span className="eyebrow">TASK COMPLETION</span><div className="large-progress"><ProgressRing value={progress} /><div><h2>{progress}% <span>complete</span></h2><p>{completed} completed · {pending} still to do</p></div></div><div className="progress-meter"><i style={{ width: `${progress}%` }} /></div><p className="subtle-note">{tasks.filter((task) => !task.needsReview).length ? `Calculated from ${tasks.filter((task) => !task.needsReview).length} approved task${tasks.filter((task) => !task.needsReview).length === 1 ? "" : "s"}.` : "Approve or add tasks to start seeing progress."}</p></section>
      <section className="glass-card progress-summary course-progress-summary"><span className="eyebrow">BY COURSE</span><h2>Every bit counts</h2>{courseData.filter((item) => item.total).length ? courseData.filter((item) => item.total).map((item) => <div className="course-stat-row" key={item.course}><div><strong>{item.course}</strong><span>{item.done}/{item.total}</span></div><span className="course-meter"><i style={{ width: `${item.value}%` }} /></span></div>) : <EmptyState icon="✧" title="Your courses will grow here" text="Progress by course appears as you add and finish tasks." />}</section></div>
    <section className="glass-card history-card"><span className="eyebrow">DAILY HISTORY · ASIA/KARACHI</span><h2>Your steady progress</h2>{history.length ? <div className="history-chart" role="list" aria-label="Daily task completion history">{history.map((snapshot) => {
      const value = snapshot.total_tasks ? Math.round(snapshot.completed_tasks / snapshot.total_tasks * 100) : 0;
      return <div className="history-day" role="listitem" key={snapshot.snapshot_date} aria-label={`${readableDate(snapshot.snapshot_date)}: ${value}% completed`}><div className="history-bar-track"><i style={{ height: `${value}%` }} /></div><strong>{value}%</strong><small>{readableDate(snapshot.snapshot_date)}</small></div>;
    })}</div> : <div className="no-history"><span>✦</span><div><strong>No progress history yet</strong><p>Daily snapshots begin when you sign in and start tracking tasks.</p></div></div>}</section>
  </>;
}

function SettingsScreen({ theme, setTheme, setScreen, dataMode, supabaseAvailable, userEmail, authEmail, setAuthEmail, authPassword, setAuthPassword, authMode, setAuthMode, authBusy, submitAuth, signOut, googleStatus, googleBusy, googleNotice, googleCalendars, selectedCalendarId, setSelectedCalendarId, connectGoogle, syncGoogle, disconnectGoogle, loadGoogleCalendars, saveGoogleCalendar, syncCalendar }: {
  theme: Theme; setTheme: (theme: Theme) => void; setScreen: (screen: Screen) => void;
  dataMode: "loading" | "local" | "signed-out" | "cloud" | "error"; supabaseAvailable: boolean; userEmail: string;
  authEmail: string; setAuthEmail: (value: string) => void; authPassword: string; setAuthPassword: (value: string) => void;
  authMode: "sign-in" | "sign-up"; setAuthMode: (value: "sign-in" | "sign-up") => void; authBusy: boolean;
  submitAuth: (event: FormEvent<HTMLFormElement>) => void; signOut: () => void;
  googleStatus: GoogleStatus; googleBusy: boolean; googleNotice: string; googleCalendars: GoogleCalendar[]; selectedCalendarId: string;
  setSelectedCalendarId: (id: string) => void; connectGoogle: () => void; syncGoogle: () => void; disconnectGoogle: () => void;
  loadGoogleCalendars: () => void; saveGoogleCalendar: (action: "create" | "select") => void; syncCalendar: () => void;
}) {
  return <><PageHeading eyebrow="MAKE STUDYFLOW YOURS" title="Settings" description="Choose how StudyFlow looks and review the current connection status." />
    <div className="settings-grid"><section className="glass-card settings-card"><div className="card-title"><div><span className="eyebrow">APPEARANCE</span><h2>Choose your atmosphere</h2></div></div><p>Both themes keep the starlit violet and rose identity.</p><div className="theme-options"><button className={`theme-option dark-preview${theme === "dark" ? " chosen" : ""}`} onClick={() => setTheme("dark")}><span className="preview-moon">☾</span><strong>Starlight</strong><small>Deep plum & violet</small>{theme === "dark" && <i>✓</i>}</button><button className={`theme-option light-preview${theme === "light" ? " chosen" : ""}`} onClick={() => setTheme("light")}><span className="preview-moon">☼</span><strong>Moonlight</strong><small>Lavender & rose</small>{theme === "light" && <i>✓</i>}</button></div><span className="subtle-note">Your theme preference is saved on this device.</span></section>
      <section className="glass-card settings-card"><div className="card-title"><div><span className="eyebrow">STUDYFLOW ACCOUNT</span><h2>{userEmail ? "Your workspace" : "Sign in or create an account"}</h2></div><span className="connection-state">{dataMode === "cloud" ? "Signed in" : dataMode === "signed-out" ? "Signed out" : dataMode === "local" ? "Local mode" : dataMode}</span></div>
        {userEmail ? <><p>Signed in as {userEmail}. Your courses and tasks are protected by your Supabase account and Row Level Security.</p><button className="button button-quiet" onClick={signOut}>Sign out</button></> :
          <>{supabaseAvailable ? <><p>With Supabase configured, your private planner data can sync to your account. Email confirmation may be required for new accounts.</p><form className="task-form" onSubmit={submitAuth}><label>Email<input required type="email" autoComplete="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label><label>Password<input required type="password" minLength={8} autoComplete={authMode === "sign-up" ? "new-password" : "current-password"} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setAuthMode(authMode === "sign-up" ? "sign-in" : "sign-up")}>{authMode === "sign-up" ? "I already have an account" : "Create account"}</button><button className="button button-primary" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "sign-up" ? "Sign up" : "Sign in"}</button></div></form></> : <div className="integration-empty"><span className="connection-label">SUPABASE · NOT CONFIGURED</span><p>Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your local environment, then restart the app to enable sign-in and account-backed courses/tasks.</p></div>}</>}
      </section>
      <section className="glass-card settings-card google-settings"><div className="card-title"><div><span className="eyebrow">CONNECTED ACCOUNTS</span><h2>Google Classroom & Gmail</h2></div><span className="connection-state"><i className="status-dot" /> {googleStatus.connected ? "Connected" : "Disconnected"}</span></div>
        {googleStatus.connected ? <><p>Connected as <strong>{googleStatus.email ?? "Google account"}</strong>. Google tokens are encrypted server-side and never sent to this browser.</p><p className="subtle-note">Last successful sync: {googleStatus.lastSyncAt ? new Date(googleStatus.lastSyncAt).toLocaleString() : "Never"}. Gmail is queried for recent Classroom-related notifications only; message snippets and relevant text are retained for your review.</p>
          <div className="settings-actions"><button className="button button-primary" disabled={googleBusy} onClick={syncGoogle}>{googleBusy ? "Syncing…" : "Sync Classroom + Gmail now"}</button><button className="button button-quiet" disabled={googleBusy} onClick={disconnectGoogle}>Disconnect and revoke</button></div>
          <div className="calendar-settings"><h3>Dedicated study calendar</h3><p>Choose a writable calendar or create a separate StudyFlow calendar. Only approved tasks and saved study blocks are written to it.</p><div className="settings-actions"><button className="button button-quiet" disabled={googleBusy} onClick={loadGoogleCalendars}>Load calendars</button><button className="button button-primary" disabled={googleBusy} onClick={() => saveGoogleCalendar("create")}>Create StudyFlow calendar</button></div>{googleCalendars.length > 0 && <div className="calendar-select-row"><label>Google calendar<select value={selectedCalendarId} onChange={(event) => setSelectedCalendarId(event.target.value)}><option value="">Choose a writable calendar</option>{googleCalendars.filter((calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer").map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label><button className="button button-quiet" disabled={googleBusy || !selectedCalendarId} onClick={() => saveGoogleCalendar("select")}>Use selected</button></div>}{googleStatus.calendarSelected && <button className="button button-quiet" disabled={googleBusy} onClick={syncCalendar}>Sync approved items to Calendar</button>}</div>
        </> : <><p>Connect a Google account to import courses, announcements, coursework, and recent Classroom-related Gmail notifications. Permissions are read-only for Classroom and Gmail; Calendar write permission is used only for your selected study calendar.</p>{dataMode === "cloud" && googleStatus.configured ? <button className="button button-primary" onClick={connectGoogle}>Connect Google account <span>→</span></button> : <p className="connection-label">{dataMode === "cloud" ? "Google OAuth, token encryption, and server-only Supabase credentials must be configured before connection." : "Sign in to StudyFlow before connecting Google. Configure the server-side Google OAuth and token-encryption keys first."}</p>}</>}
        {googleNotice && <p className="notice" role="status">{googleNotice}</p>}
      </section>
      <section className="glass-card settings-card data-settings"><div className="card-title"><div><span className="eyebrow">YOUR DATA</span><h2>{dataMode === "cloud" ? "Account-backed planner data" : "Local planner data"}</h2></div></div><p>{dataMode === "cloud" ? "Courses, tasks, imported sources, and study blocks are stored in Supabase under your signed-in user. Theme preference remains local." : "Without Supabase configuration, manually created courses, tasks, study blocks, and theme preference are stored in this browser only."}</p><span className="local-mode"><i className="status-dot" /> {dataMode === "cloud" ? "Supabase account mode" : "Local device mode"}</span></section>
    </div>
  </>;
}
