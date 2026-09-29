import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
} from "./config.js";

// Start only the feature belonging to this HTML page.
// Page links load real documents; no sections are hidden to simulate pages.
async function initializeApplication() {
  const page = document.body?.dataset.page || "legacy";
  let statusMessage = document.querySelector("#connection-status");
  if (!statusMessage) {
    const homeSection = document.querySelector("#home");
    if (!homeSection) return;
    statusMessage = document.createElement("p");
    statusMessage.classList.add("system-message");
    homeSection.appendChild(statusMessage);
  }
  statusMessage.textContent = "Loading this page...";
  try {
    if (!window.supabase) throw new Error("The Supabase library did not load. Check your connection.");
    const database = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    if (page === "home") {
      const refreshButton = requiredElement("#refresh-overview");
      const refresh = async () => {
        refreshButton.disabled = true;
        statusMessage.textContent = "Refreshing overview...";
        statusMessage.dataset.state = "loading";
        try {
          await loadDashboard(database);
          statusMessage.textContent = "Overview updated from the database.";
          statusMessage.dataset.state = "success";
        } catch (error) {
          statusMessage.textContent = "Could not refresh the overview. Displayed values may be out of date; try Refresh overview.";
          statusMessage.dataset.state = "error";
          console.error("Overview error:", error);
        } finally { refreshButton.disabled = false; }
      };
      refreshButton.addEventListener("click", refresh);
      await refresh();
    } else if (page === "vehicles") {
      await loadVehicles(database, statusMessage);
      connectVehicleForm(database, statusMessage);
    } else if (page === "new-request") {
      const refreshAvailability = connectRequestForm(database, () => {
        const receiptLink = document.querySelector("#saved-request-link");
        if (receiptLink) receiptLink.hidden = false;
      });
      await refreshAvailability();
      statusMessage.textContent = "Form ready. Check availability before saving a request.";
    } else if (page === "requests") {
      const refreshRequests = connectRequestList(database);
      const loaded = await refreshRequests({ reloadVehicles: true });
      statusMessage.textContent = loaded
        ? "Request records loaded. Use the vehicle filter to narrow the list."
        : "Could not load requests. Use Refresh requests to try again.";
    } else {
      // Temporary compatibility while the user replaces the old single-page HTML.
      await loadVehicles(database, statusMessage);
      const refreshRequests = connectRequestList(database);
      const refreshAvailability = connectRequestForm(database, () => refreshRequests({ resetFilter: true }));
      connectVehicleForm(database, statusMessage, async () => {
        await refreshAvailability();
        await refreshRequests({ reloadVehicles: true });
      });
      await Promise.all([refreshAvailability(), refreshRequests({ reloadVehicles: true })]);
    }
  } catch (error) {
    statusMessage.textContent = "Page setup failed: " + error.message;
    statusMessage.dataset && (statusMessage.dataset.state = "error");
    console.error("Application setup error:", error);
  }
}

// Step 2: Fetch saved records and update the list and its count.
async function loadVehicles(database, statusMessage) {
  const data = await readAllRows(() => database.from("vehicles")
    .select("id, registration_number, vehicle_model")
    .order("registration_number").order("id"));
  renderVehicles(data);
  statusMessage.textContent = "Registered vehicles: " + data.length;
}

// Step 3: Read the form and validate values before sending them.
function readVehicleForm(form) {
  const fields = new FormData(form);
  const text = (name) => String(fields.get(name) ?? "").trim();

  const vehicle = {
    registration_number: text("registration_number").toUpperCase(),
    vehicle_name: text("vehicle_name"),
    vehicle_model: text("vehicle_model"),
    capacity: Number(text("capacity")),
    mileage_km: Number(text("mileage_km")),
    operational_status: text("operational_status"),
    photo_url: text("photo_url") || null
  };

  if (!vehicle.registration_number || !vehicle.vehicle_name || !vehicle.vehicle_model) {
    throw new Error("Enter a registration number, vehicle name, and vehicle model.");
  }
  if (!text("capacity") || !Number.isInteger(vehicle.capacity) ||
      vehicle.capacity < 1 || vehicle.capacity > 2147483647) {
    throw new Error("Passenger capacity must be a positive whole number within the database limit.");
  }
  if (!text("mileage_km") || !Number.isInteger(vehicle.mileage_km) ||
      vehicle.mileage_km < 0 || vehicle.mileage_km > 2147483647) {
    throw new Error("Mileage must be a non-negative whole number within the database limit.");
  }
  if (!["Available", "Maintenance"].includes(vehicle.operational_status)) {
    throw new Error("Choose Available or Maintenance.");
  }
  if (vehicle.photo_url) {
    let photo;
    try {
      photo = new URL(vehicle.photo_url);
    } catch {
      throw new Error("Enter a valid photo URL, or leave it empty.");
    }
    if (!["http:", "https:"].includes(photo.protocol)) {
      throw new Error("The photo URL must start with http:// or https://.");
    }
    vehicle.photo_url = photo.href;
  }

  return vehicle;
}

// Step 4: Save a vehicle only when the user submits the form.
function connectVehicleForm(database, statusMessage, refreshAvailability) {
  const form = document.querySelector("#vehicle-form");
  const button = document.querySelector("#save-vehicle-button");
  const message = document.querySelector("#vehicle-form-message");
  if (!form || !button || !message) {
    throw new Error("The vehicle form, button, or message area could not be found.");
  }

  let saving = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;

    let vehicle;
    try {
      vehicle = readVehicleForm(form);
    } catch (error) {
      message.textContent = error.message;
      return;
    }

    saving = true;
    button.disabled = true;
    button.textContent = "Saving...";
    message.textContent = "Saving vehicle...";

    try {
      // The database generates id and created_at automatically.
      const { error } = await database.from("vehicles").insert(vehicle);

      if (error) {
        const messages = {
          "23505": "This registration number already exists. Use a different one.",
          "23514": "The vehicle does not meet the database validation rules.",
          "23502": "A required vehicle field is missing.",
          "42501": "Vehicle registration is not permitted by the database access settings."
        };
        message.textContent = messages[error.code] ||
          "The save could not be confirmed. Reload and check the list before trying again.";
        console.error("Vehicle insert error:", error);
        return;
      }

      // Clear the fields only after Supabase confirms the insert.
      form.reset();
      message.textContent = `Vehicle ${vehicle.registration_number} saved successfully.`;

      try {
        await loadVehicles(database, statusMessage);
        if (refreshAvailability) await refreshAvailability();
      } catch (error) {
        // A refresh failure does not undo an already successful insert.
        message.textContent = "Vehicle saved, but the list could not refresh. Reload the page; do not submit it again.";
        console.error("Vehicle list refresh error:", error);
      }
    } catch (error) {
      message.textContent = "The save could not be confirmed. Reload and check the list before trying again.";
      console.error("Vehicle save connection error:", error);
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = "Save vehicle";
    }
  });

  button.disabled = false;
}

// Step 5: Display database values as text, not executable HTML.
function renderVehicles(vehicles) {
  const vehicleList = document.querySelector("#vehicle-list");
  if (!vehicleList) {
    throw new Error("The vehicle list could not be found.");
  }

  vehicleList.replaceChildren();
  if (vehicles.length === 0) {
    vehicleList.textContent = "No vehicles found.";
    return;
  }

  for (const vehicle of vehicles) {
    const vehicleItem = document.createElement("p");
    vehicleItem.textContent = `${vehicle.registration_number} — ${vehicle.vehicle_model}`;
    vehicleList.appendChild(vehicleItem);
  }
}

// Step 6: Use Mozambique time explicitly, independent of the computer's timezone.
const ACTIVE_REQUEST_STATUSES = ["Pending", "Approved", "Postponed"];
const REQUEST_STATUSES = [...ACTIVE_REQUEST_STATUSES, "Completed", "Cancelled"];
const MOZAMBIQUE_OFFSET_MS = 2 * 60 * 60 * 1000;

function requiredElement(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error("Missing page element: " + selector);
  return element;
}

function wholeNumber(value, label, minimum) {
  const number = Number(value);
  if (String(value).trim() === "" || !Number.isInteger(number) ||
      number < minimum || number > 2147483647) {
    throw new Error(label + " must be a whole number of at least " + minimum + ".");
  }
  return number;
}

function formatMozambiqueTime(value) {
  const shifted = new Date(new Date(value).getTime() + MOZAMBIQUE_OFFSET_MS);
  return shifted.toISOString().slice(0, 16).replace("T", " ") + " (UTC+02:00)";
}

function readRequestSchedule(form) {
  const fields = new FormData(form);
  const localStart = String(fields.get("start_at") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localStart) ||
      Number(localStart.slice(0, 4)) < 1) {
    throw new Error("Enter a valid start date and time.");
  }

  const start = new Date(localStart + ":00+02:00");
  if (!Number.isFinite(start.getTime()) ||
      new Date(start.getTime() + MOZAMBIQUE_OFFSET_MS).toISOString().slice(0, 16) !== localStart) {
    throw new Error("Enter a valid start date and time.");
  }

  const duration = wholeNumber(fields.get("activity_duration_minutes") ?? "", "Activity duration", 1);
  const buffer = wholeNumber(fields.get("travel_buffer_minutes") ?? "", "Travel buffer", 0);
  const passengers = wholeNumber(fields.get("passenger_count") ?? "", "Passenger count", 1);
  const end = new Date(start.getTime() + (duration + buffer) * 60000);
  if (!Number.isFinite(end.getTime()) || end.getUTCFullYear() > 9999) {
    throw new Error("The calculated return date is outside the supported range.");
  }
  const status = String(fields.get("status") ?? "");
  if (!REQUEST_STATUSES.includes(status)) throw new Error("Select a valid request status.");

  return {
    start_at: start.toISOString(),
    activity_duration_minutes: duration,
    travel_buffer_minutes: buffer,
    expected_return_at: end.toISOString(),
    passenger_count: passengers,
    status
  };
}

function scheduleKey(schedule) {
  return JSON.stringify([
    schedule.start_at, schedule.expected_return_at,
    schedule.passenger_count, schedule.status
  ]);
}

// Step 7: Read all matching pages so a row limit cannot hide a conflicting booking.
async function readAllRows(buildQuery) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + 199);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("The database returned an unexpected response.");
    if (data.length === 0) return rows;
    rows.push(...data);
    offset += data.length;
  }
}

async function findAvailableVehicles(database, schedule) {
  const vehicleQuery = () => database.from("vehicles")
    .select("id, registration_number, vehicle_model, capacity, operational_status")
    .eq("operational_status", "Available")
    .gte("capacity", schedule.passenger_count)
    .order("id");

  // Completed/Cancelled records do not reserve a period.
  const blockingQuery = () => database.from("transport_requests")
    .select("id, vehicle_id")
    .in("status", ACTIVE_REQUEST_STATUSES)
    .lt("start_at", schedule.expected_return_at)
    .gt("expected_return_at", schedule.start_at)
    .order("id");

  const [vehicles, bookings] = await Promise.all([
    readAllRows(vehicleQuery),
    ACTIVE_REQUEST_STATUSES.includes(schedule.status)
      ? readAllRows(blockingQuery) : Promise.resolve([])
  ]);
  const blockedIds = new Set(bookings.map(booking => String(booking.vehicle_id)));
  return vehicles.filter(vehicle => !blockedIds.has(String(vehicle.id)));
}

// Step 8: Build a request with column names that match transport_requests.
function readRequestForm(form) {
  const fields = new FormData(form);
  const text = name => String(fields.get(name) ?? "").trim();
  const schedule = readRequestSchedule(form);
  const request = {
    ...schedule,
    requester_name: text("requester_name"),
    department: text("department") === "Other" ? text("other_department") : text("department"),
    program_project: text("program_project") === "Other"
      ? text("other_program_project") : text("program_project"),
    origin: text("origin"),
    destination: text("destination"),
    stops: text("stops") || null,
    purpose: text("purpose"),
    passenger_names: text("passenger_names"),
    // Use the selected database ID, never the option's position in the list.
    vehicle_id: text("vehicle_id")
  };

  for (const key of ["requester_name", "department", "program_project",
                    "origin", "destination", "purpose", "passenger_names"]) {
    if (!request[key]) throw new Error("Complete all required request fields.");
  }
  if (!/^[1-9]\d*$/.test(request.vehicle_id)) {
    throw new Error("Choose an available vehicle.");
  }
  if (request.passenger_names.toLowerCase() === "various") {
    if (request.passenger_count < 8) {
      throw new Error("Various is allowed only for 8 or more passengers.");
    }
    request.passenger_names = "Various";
  } else {
    const names = request.passenger_names.split(",").map(name => name.trim());
    if (names.some(name => !name) || names.length !== request.passenger_count) {
      throw new Error("Enter exactly one name per passenger, separated by commas.");
    }
    request.passenger_names = names.join(", ");
  }
  return request;
}

// Step 9: Activate Other fields, calculate the return, and load vehicle options.
// Other is stored only on this request; it does not create a shared department.
function connectRequestForm(database, onRequestSaved) {
  const form = requiredElement("#request-form");
  const button = requiredElement("#save-request-button");
  const message = requiredElement("#request-form-message");
  const vehicleSelect = requiredElement("#request-vehicle");
  const availability = requiredElement("#vehicle-availability-message");
  const returnOutput = requiredElement("#expected-return");
  const otherFields = [
    ["#request-department", "#other-department-field", "#other-department"],
    ["#request-program", "#other-program-field", "#other-program"]
  ];
  const watchedIds = new Set([
    "request-start", "activity-duration", "travel-buffer", "passenger-count", "request-status"
  ]);

  // This retry button is created here; no further HTML edit is needed.
  const refreshButton = document.createElement("button");
  refreshButton.id = "check-vehicle-availability";
  refreshButton.type = "button";
  refreshButton.textContent = "Check availability";
  availability.before(refreshButton);

  let vehicles = [];
  let checkedKey = null;
  let version = 0;
  let timer;
  let saving = false;
  let uncertainSave = false;

  function syncOtherFields() {
    for (const [selectId, wrapperId, inputId] of otherFields) {
      const isOther = requiredElement(selectId).value === "Other";
      requiredElement(wrapperId).hidden = !isOther;
      const input = requiredElement(inputId);
      input.disabled = !isOther;
      input.required = isOther;
    }
  }

  function syncSaveButton() {
    button.disabled = saving || uncertainSave || !checkedKey ||
      !vehicles.some(vehicle => String(vehicle.id) === vehicleSelect.value);
  }

  function clearAvailability(label) {
    version += 1;
    checkedKey = null;
    vehicles = [];
    vehicleSelect.replaceChildren(new Option(label, ""));
    vehicleSelect.disabled = true;
    button.disabled = true;
  }

  async function refreshAvailability() {
    if (saving) return;
    clearTimeout(timer);
    clearAvailability("Checking availability...");
    const currentVersion = version;
    let schedule;
    try {
      schedule = readRequestSchedule(form);
      returnOutput.textContent = formatMozambiqueTime(schedule.expected_return_at);
    } catch (error) {
      const startIsEmpty = !requiredElement("#request-start").value;
      returnOutput.textContent = startIsEmpty
        ? "Enter a start date and time to calculate the return."
        : "Enter a valid schedule and passenger count.";
      availability.textContent = startIsEmpty
        ? "Choose the schedule and passenger count for your next request."
        : error.message;
      vehicleSelect.replaceChildren(new Option("Complete the schedule and passenger count first", ""));
      return;
    }

    availability.textContent = "Checking vehicle condition, capacity, and existing requests...";
    try {
      const available = await findAvailableVehicles(database, schedule);
      // Ignore an older response if the user has changed the inputs meanwhile.
      if (currentVersion !== version || saving) return;
      vehicles = available;
      checkedKey = scheduleKey(schedule);
      vehicleSelect.replaceChildren(new Option(
        vehicles.length ? "Select an available vehicle" : "No eligible vehicles found", ""
      ));
      for (const vehicle of vehicles) {
        vehicleSelect.appendChild(new Option(
          vehicle.registration_number + " - " + vehicle.vehicle_model +
          " (" + vehicle.capacity + " passengers)", String(vehicle.id)
        ));
      }
      vehicleSelect.disabled = vehicles.length === 0;
      availability.textContent = vehicles.length
        ? vehicles.length + " eligible vehicle(s). Select one before saving."
        : "No eligible vehicles. Try a different time or passenger count.";
      if (!ACTIVE_REQUEST_STATUSES.includes(schedule.status)) {
        availability.textContent += " This status does not reserve a time slot.";
      }
      syncSaveButton();
    } catch (error) {
      if (currentVersion !== version || saving) return;
      clearAvailability("Availability could not be checked");
      availability.textContent = "Availability check failed. Use Check availability to retry.";
      console.error("Availability error:", error);
    }
  }

  function scheduleChanged(event) {
    if (saving || !watchedIds.has(event.target.id)) return;
    clearTimeout(timer);
    clearAvailability("Rechecking the schedule...");
    try {
      returnOutput.textContent = formatMozambiqueTime(readRequestSchedule(form).expected_return_at);
    } catch {
      returnOutput.textContent = "Enter a valid schedule and passenger count.";
    }
    timer = setTimeout(refreshAvailability, 300);
  }

  for (const [selectId] of otherFields) {
    requiredElement(selectId).addEventListener("change", syncOtherFields);
  }
  form.addEventListener("input", scheduleChanged);
  form.addEventListener("change", scheduleChanged);
  vehicleSelect.addEventListener("change", syncSaveButton);
  refreshButton.addEventListener("click", refreshAvailability);
  syncOtherFields();
  message.textContent = "Complete the form, check availability, and select a vehicle.";

  // Step 10: Recheck availability, then let PostgreSQL enforce the final rules.
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || uncertainSave || !form.reportValidity()) return;

    let request;
    try {
      request = readRequestForm(form);
      if (scheduleKey(request) !== checkedKey ||
          !vehicles.some(vehicle => String(vehicle.id) === request.vehicle_id)) {
        throw new Error("Check availability again and select an eligible vehicle.");
      }
    } catch (error) {
      message.textContent = error.message;
      return;
    }

    saving = true;
    version += 1;
    clearTimeout(timer);
    // Keep all fields stable while the network operation is in progress.
    const controls = Array.from(form.elements).map(control => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    button.textContent = "Saving...";
    message.textContent = "Rechecking availability before saving...";
    let insertStarted = false;

    try {
      const freshVehicles = await findAvailableVehicles(database, request);
      const selected = freshVehicles.find(vehicle => String(vehicle.id) === request.vehicle_id);
      if (!selected) throw new Error("That vehicle is no longer eligible. Choose another vehicle or time.");

      message.textContent = "Saving transport request...";
      insertStarted = true;
      const { data, error } = await database.from("transport_requests")
        .insert(request)
        .select("id, expected_return_at")
        .single();
      if (error) throw error;
      if (!data || data.id == null || !data.expected_return_at) {
        throw new Error("The save response could not be verified.");
      }

      message.textContent = "Request #" + data.id + " saved successfully. Vehicle: " +
        selected.registration_number + ". Expected return: " +
        formatMozambiqueTime(data.expected_return_at) + ".";
      form.reset();

      // A list-refresh failure must never be described as a failed insert.
      if (onRequestSaved) {
        try {
          const refreshed = await onRequestSaved();
          if (refreshed === false) {
            message.textContent += " The list could not refresh. Use Refresh requests; do not submit this request again.";
          }
        } catch (refreshError) {
          message.textContent += " The list could not refresh. Use Refresh requests; do not submit this request again.";
          console.error("Saved request list refresh error:", refreshError);
        }
      }
    } catch (error) {
      const knownErrors = {
        "23P01": "The vehicle was booked for an overlapping period. Choose another vehicle or time.",
        "23514": "The request failed a database rule. Check passengers, schedule, and vehicle condition.",
        "23503": "The selected vehicle no longer exists. Choose another vehicle.",
        "23502": "A required request field is missing.",
        "42501": "Your current database access does not permit this request.",
        "23505": "The database rejected a duplicate record."
      };
      if (!insertStarted) {
        message.textContent = "Request not saved: " + (error.message || "Availability could not be verified.");
      } else if (knownErrors[error.code]) {
        message.textContent = "Request not saved: " + knownErrors[error.code];
      } else {
        // Never automatically retry an insert with an uncertain network outcome.
        uncertainSave = true;
        message.textContent = "The save could not be confirmed. Check transport_requests in Supabase before trying again. Reload this page after checking.";
      }
      console.error("Request save error:", error);
    } finally {
      for (const [control, wasDisabled] of controls) control.disabled = wasDisabled;
      saving = false;
      button.textContent = "Save request";
      syncOtherFields();
      await refreshAvailability();
      syncSaveButton();
    }
  });

  return refreshAvailability;
}

// Step 11: Read both related tables in one Supabase query.
// vehicle:vehicles(...) follows transport_requests.vehicle_id -> vehicles.id.
async function fetchTransportRequests(database, vehicleId = "") {
  return readAllRows(() => {
    let query = database.from("transport_requests").select(
      "id, created_at, requester_name, department, program_project, " +
      "start_at, expected_return_at, activity_duration_minutes, travel_buffer_minutes, " +
      "origin, destination, stops, purpose, passenger_count, passenger_names, status, vehicle_id, " +
      "vehicle:vehicles(registration_number, vehicle_name, vehicle_model)"
    );
    if (vehicleId) query = query.eq("vehicle_id", vehicleId);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false });
  });
}

// Step 12: Render text safely, including values entered by the user.
function renderTransportRequests(requests, container) {
  container.replaceChildren();
  if (requests.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No transport requests match this filter.";
    container.appendChild(empty);
    return;
  }

  function addLine(parent, label, value) {
    const line = document.createElement("p");
    line.textContent = label + ": " + (value == null || value === "" ? "Not provided" : value);
    parent.appendChild(line);
  }
  function displayTime(value) {
    return value && Number.isFinite(new Date(value).getTime())
      ? formatMozambiqueTime(value) : "Unavailable";
  }

  for (const request of requests) {
    const card = document.createElement("article");
    card.classList.add("request-card");
    const heading = document.createElement("h3");
    heading.textContent = "Request #" + request.id + " - " + request.status;
    card.appendChild(heading);

    const vehicle = request.vehicle;
    addLine(card, "Vehicle", vehicle
      ? vehicle.registration_number + " - " + vehicle.vehicle_name + " " + vehicle.vehicle_model
      : "Vehicle #" + request.vehicle_id + " (details unavailable)");
    addLine(card, "Requester", request.requester_name);
    addLine(card, "Route", request.origin + " to " + request.destination);
    addLine(card, "Start", displayTime(request.start_at));
    addLine(card, "Expected return", displayTime(request.expected_return_at));
    addLine(card, "Passengers", request.passenger_count);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Show request details";
    details.appendChild(summary);
    addLine(details, "Department", request.department);
    addLine(details, "Program or project", request.program_project);
    addLine(details, "Purpose", request.purpose);
    addLine(details, "Stops or itinerary", request.stops || "No intermediate stops");
    addLine(details, "Passenger names", request.passenger_names);
    addLine(details, "Activity duration (minutes)", request.activity_duration_minutes);
    addLine(details, "Travel buffer (minutes)", request.travel_buffer_minutes);
    card.appendChild(details);
    container.appendChild(card);
  }
}

// Step 13: Populate the filter and refresh the list after inserts or user actions.
function connectRequestList(database) {
  const filter = requiredElement("#request-vehicle-filter");
  const button = requiredElement("#refresh-requests-button");
  const message = requiredElement("#request-list-message");
  const container = requiredElement("#request-list");
  let filterVehicles = [];
  let filterReady = false;
  let version = 0;

  async function refreshRequests({ reloadVehicles = false, resetFilter = false } = {}) {
    const currentVersion = ++version;
    let vehicleId = resetFilter ? "" : filter.value;
    if (resetFilter) filter.value = "";
    button.disabled = true;
    container.setAttribute("aria-busy", "true");
    container.replaceChildren();
    message.textContent = "Loading transport requests...";

    try {
      if (reloadVehicles || !filterReady) {
        const vehicles = await readAllRows(() => database.from("vehicles")
          .select("id, registration_number, vehicle_model").order("id"));
        if (currentVersion !== version) return null;
        filterVehicles = vehicles;
        filter.replaceChildren(new Option("All vehicles", ""));
        // Include Maintenance vehicles too: their historical requests are still relevant.
        for (const vehicle of vehicles) {
          filter.appendChild(new Option(
            vehicle.registration_number + " - " + vehicle.vehicle_model, String(vehicle.id)
          ));
        }
        vehicleId = vehicles.some(vehicle => String(vehicle.id) === vehicleId) ? vehicleId : "";
        filter.value = vehicleId;
        filter.disabled = false;
        filterReady = true;
      }

      const requests = await fetchTransportRequests(database, vehicleId);
      if (currentVersion !== version) return null;
      renderTransportRequests(requests, container);
      const selected = filterVehicles.find(vehicle => String(vehicle.id) === vehicleId);
      message.textContent = requests.length + " transport request(s) shown - " +
        (vehicleId ? (selected?.registration_number || "selected vehicle") : "all vehicles") + ".";
      if (requests.some(request => !request.vehicle)) {
        message.textContent += " Some vehicle details are unavailable; check vehicle read access.";
      }
      return true;
    } catch (error) {
      if (currentVersion !== version) return null;
      container.replaceChildren();
      message.textContent = error.code === "PGRST201"
        ? "The vehicle relationship is ambiguous. Check the existing foreign keys before changing the SQL."
        : "Could not load transport requests. Check the connection and use Refresh requests.";
      console.error("Transport request list error:", error);
      return false;
    } finally {
      if (currentVersion === version) {
        button.disabled = false;
        container.setAttribute("aria-busy", "false");
      }
    }
  }

  filter.addEventListener("change", () => refreshRequests());
  button.addEventListener("click", () => refreshRequests({ reloadVehicles: true }));
  return refreshRequests;
}

// Homepage: totals and recent records are derived from returned database rows.
async function loadDashboard(database) {
  const [vehicles, requests] = await Promise.all([
    readAllRows(() => database.from("vehicles")
      .select("id, operational_status").order("id")),
    readAllRows(() => database.from("transport_requests")
      .select("id, created_at, origin, destination, status, start_at, vehicle_id, vehicle:vehicles(registration_number, vehicle_model)")
      .order("created_at", { ascending: false }).order("id", { ascending: false }))
  ]);
  requiredElement("#total-vehicles").textContent = String(vehicles.length);
  requiredElement("#total-requests").textContent = String(requests.length);
  requiredElement("#pending-requests").textContent = String(requests.filter(row => row.status === "Pending").length);
  requiredElement("#operational-vehicles").textContent = String(vehicles.filter(row => row.operational_status === "Available").length);
  const summary = requiredElement("#request-status-summary");
  summary.replaceChildren();
  for (const status of REQUEST_STATUSES) {
    const count = requests.filter(row => row.status === status).length;
    const row = document.createElement("div");
    row.className = "status-total";
    row.dataset.status = status.toLowerCase();
    const label = document.createElement("span"); label.textContent = status;
    const number = document.createElement("strong"); number.textContent = String(count);
    const track = document.createElement("span"); track.className = "status-track"; track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span"); fill.style.width = (requests.length ? count / requests.length * 100 : 0) + "%";
    track.appendChild(fill); row.append(label, number, track); summary.appendChild(row);
  }
  const list = requiredElement("#recent-requests");
  list.replaceChildren();
  if (!requests.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4; cell.textContent = "No requests yet. Create your first journey.";
    row.appendChild(cell); list.appendChild(row);
    return;
  }
  for (const request of requests.slice(0, 5)) {
    const row = document.createElement("tr");
    const route = document.createElement("td");
    const id = document.createElement("strong"); id.textContent = "Request #" + request.id;
    const description = document.createElement("small"); description.textContent = request.origin + " → " + request.destination;
    route.append(id, description);
    const vehicle = document.createElement("td"); vehicle.textContent = request.vehicle?.registration_number || "Vehicle #" + request.vehicle_id;
    const start = document.createElement("td");
    start.textContent = request.start_at && Number.isFinite(new Date(request.start_at).getTime())
      ? formatMozambiqueTime(request.start_at).replace(" (UTC+02:00)", "") : "Unavailable";
    const state = document.createElement("td");
    const badge = document.createElement("span"); badge.className = "status-badge"; badge.textContent = request.status;
    badge.dataset.status = String(request.status).toLowerCase();
    state.appendChild(badge); row.append(route, vehicle, start, state); list.appendChild(row);
  }
}

initializeApplication();

