var express = require("express");
var moment = require("moment");
require("moment-duration-format");
const path = require("path");
const axios = require("axios");
var app = express();
var server = require("http").Server(app);
var io = require("socket.io")(server, {
  cors: {
    origin: "*",
  },
});
require("dotenv").config();
var exec = require("child_process").exec;
var utils = require("./utils");
const bodyParser = require("body-parser");
const { connect } = require("http2");
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const api = {};
var server_port = 10070;
var server_host =
  process.env.NODE_ENV == "development" ? "0.0.0.0" : "103.81.85.224";
server.listen(server_port, server_host, function () {
  console.log("Haca Live Music Server đang chạy tại cổng: %d", server_port);
});
require("dns").lookup(require("os").hostname(), function (err, add, fam) {
  console.log("Với địa chỉ: " + add);
});

async function liveServer(params) {
  // Getting idle videos info from PHP server
  const idle = await axios
    .get("https://api.c4k60.com/v1.0/radio/idle")
    .catch((e) => console.log("error:", e.code, e.hostname));
  let getIdle = new Promise((resolve, reject) => {
    if (idle.data.idle_playlist) {
      resolve(idle.data.idle_playlist);
    } else {
      reject("Không thể kết nối đến server lấy bài hát hàng đợi!");
    }
  });

  api["video_in_queue"] = [];

  getIdle
    .then((data) => {
      api["server_idle_videos_playback_id"] = data;
      api["total_idle_videos"] = data.length;
      for (const video of api["server_idle_videos_playback_id"]) {
        utils.getSnippet(video).then((res) => {
          utils
            .getChannelAvatar(res.items[0].snippet.channelId)
            .then((res2) => {
              api["video_in_queue"].push({
                position:
                  api["server_idle_videos_playback_id"].indexOf(video) + 1,
                idle_id: api["server_idle_videos_playback_id"].indexOf(video),
                is_idle_video: true,
                video_id: video,
                video_title: res.items[0].snippet.title,
                video_thumbnail: res.items[0].snippet.thumbnails.default.url,
                video_duration: parseInt(
                  moment
                    .duration(res.items[0].contentDetails.duration)
                    .format("s")
                ),
                uploaded_by: res.items[0].snippet.channelTitle,
                channel_avatar: res2.items[0].snippet.thumbnails.default.url,
                video_views: parseInt(res.items[0].statistics.viewCount),
                published_at: res.items[0].snippet.publishedAt,
                requested_by: "Dương Tùng Anh",
                voting: {
                  like_count: 0,
                  liked_by: [],
                  disliked_by: [],
                  vote_skip: 0,
                  vote_remove: 0,
                },
              });

              // Code that need to be waited and refreshed right after new video pushed into array
              api["video_in_queue"] = utils.shuffle(api["video_in_queue"]);
              reloadOrder();
              api["total_videos"] = api["video_in_queue"].length;
              api["current_video_duration"] =
                api["video_in_queue"][
                  api["now_playing_position"] - 1
                ]?.video_duration;
              api["now_playing_video_info"] = api["video_in_queue"][0];
            });
        });
      }
    })
    .catch((err) => console.log(err));

  // Init counters first
  api["queue_by_users"] = [];
  api["now_playing_position"] = 1;
  api["current_video_duration"] = 0;
  api["elapsed_time"] = 0;

  // The function that reload the queue order
  function reloadOrder() {
    api["video_in_queue"].forEach((ele, index) => {
      ele.position = index + 1;
    });
  }

  // The magic of live radio happens here ^^
  var refresh = setInterval(() => {
    // Increase elapsed time by one second
    api["elapsed_time"]++;
    // If elapsed time exceeds current video duration then change to the next song
    if (api["elapsed_time"] >= api["current_video_duration"]) {
      // Reset the elapsed time counter
      api["elapsed_time"] = 0;
      // Increase the position
      api["now_playing_position"]++;
      // Refresh our stats
      api["current_video_duration"] =
        api["video_in_queue"][api["now_playing_position"] - 1]?.video_duration;
      api["now_playing_video_info"] =
        api["video_in_queue"][api["now_playing_position"] - 1];
      // If we reach the end of the playlist then reset counters and replay with shuffle
      if (
        api["now_playing_position"] > api["total_videos"] ||
        api["now_playing_position"] < 1
      ) {
        api["now_playing_position"] = 1;
        clearInterval(refresh);
        liveServer();
      }
    }
  }, 1000);

  // Users watching counter
  api["users_watching"] = 0;
  api["now_watching"] = [];

  if (params == "clear") {
    clearInterval(refresh);
  }
}

// Here is the websocket part that handle the live events between clients and server

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

var connectCounter = 0;
io.on("connection", function (socket) {
  socket.on("conn", (username) => {
    io.emit("views");
    console.log(`Người dùng: ${username} đã kết nối!`);
    api["now_watching"].push(username);
    connectCounter = connectCounter + 1;
    console.log("Ai đó vừa kết nối với ID: " + socket.id);
    console.log("Tổng số người đang xem: " + connectCounter);
    api["users_watching"] = connectCounter;
    api["now_watching"] = api["now_watching"].filter(onlyUnique);
    connectCounter = api["now_watching"].length;
    api["users_watching"] = connectCounter;
  });

  socket.on("discon", (username) => {
    console.log(`Người dùng: ${username} đã ngắt kết nối!`);
    api["now_watching"].splice(api["now_watching"].indexOf(username), 1);
    connectCounter--;
    if (connectCounter < 0) {
      connectCounter = 0;
      api["users_watching"] = connectCounter;
    }
    io.emit("views");
    console.log("Total users: " + connectCounter);
    api["users_watching"] = connectCounter;
    if (api["now_watching"].length > api["users_watching"]) {
      api["now_watching"].splice(-1);
    }
  });

  socket.on("disconnect", function () {
    // connectCounter--;
    io.emit("views");
    console.log(
      "Người dùng đã thoát! Tổng số người xem hiện tại: " + connectCounter
    );
    // api["users_watching"] = connectCounter;
    // if (api["now_watching"].length > api["users_watching"]) {
    //   api["now_watching"].splice(-1);
    // }
  });

  socket.on("chat-message", (data) => {
    console.log(data.username + ": " + data.message);
    io.emit("chat-message", {
      name: data.name,
      username: data.username,
      message: data.message,
    });
  });

  socket.on("add-queue", (data) => {
    console.log("Máy chủ đã nhận được video với ID: " + data.id);
    utils.getSnippet(data.id).then((res) => {
      utils.getChannelAvatar(res.items[0].snippet.channelId).then((res2) => {
        api["queue_by_users"].push({
          position: 1,
          is_idle_video: false,
          video_id: data.id,
          video_title: res.items[0].snippet.title,
          video_thumbnail: res.items[0].snippet.thumbnails.default.url,
          video_duration: parseInt(
            moment.duration(res.items[0].contentDetails.duration).format("s")
          ),
          uploaded_by: res.items[0].snippet.channelTitle,
          channel_avatar: res2.items[0].snippet.thumbnails.default.url,
          video_views: parseInt(res.items[0].statistics.viewCount),
          published_at: res.items[0].snippet.publishedAt,
          requested_by: data.requester,
          voting: {
            like_count: 0,
            liked_by: [],
            disliked_by: [],
            vote_skip: 0,
            vote_remove: 0,
          },
        });

        // Code that need to be waited right after new video pushed into array
        api["queue_by_users"].forEach((ele, index) => {
          ele.position = index + 1;
        });
        api["total_videos"] = api["video_in_queue"].length;
        api["current_video_duration"] =
          api["video_in_queue"][api["now_playing_position"] - 1].video_duration;
        api["now_playing_video_info"] = api["video_in_queue"][0];
        api["video_in_queue"].unshift(api["queue_by_users"]);
        api["elapsed_time"] = 0;
      });
    });
  });
});

// Don't forget to run your main function!
liveServer();

// The API is going publicly live!!!!
// But we need to set a timeout for undefined safety

app.get("/live", function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(api);
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname + "/index.html"));
});

app.get("/assets/style", (req, res) => {
  res.sendFile(path.join(__dirname + "/style.css"));
});

app.get("/assets/search", (req, res) => {
  res.sendFile(path.join(__dirname + "/assets/search.png"));
});

app.get("/assets/logo", (req, res) => {
  res.sendFile(path.join(__dirname + "/assets/app-logo.png"));
});

app.get("/assets/chat", (req, res) => {
  res.sendFile(path.join(__dirname + "/assets/chat.png"));
});

app.get("/admin/api/shuffle", function (req, res) {
  liveServer("clear");
  res.send("Xáo trộn bài hát thành công!");
});

app.get("/admin/api/client/refresh", function (req, res) {
  res.send("Gửi tín hiệu Refresh đến người dùng thành công!");
  io.emit("refresh");
});

app.get("/admin/api/client/play", function (req, res) {
  res.send("Gửi tín hiệu Play đến người dùng thành công!");
  io.emit("play");
});

app.get("/admin/api/songs/reload-order", function (req, res) {
  api["video_in_queue"].forEach((ele, index) => {
    ele.position = index + 1;
  });
  res.send("Làm mới thứ tự bài hát thành công!");
});

app.get("/admin/api/player/forward", function (req, res) {
  api["elapsed_time"] += 10;
  io.emit("refresh");
  res.send("Tua tiến 10 giây thành công!");
});

app.get("/admin/api/player/rewind", function (req, res) {
  api["elapsed_time"] -= 10;
  io.emit("refresh");
  res.send("Tua lùi 10 giây thành công!");
});

app.get("/admin/api/player/next", function (req, res) {
  api["now_playing_position"]++;
  api["elapsed_time"] = 0;
  // If we reach the end of the playlist then reset counters and replay with shuffle
  if (
    api["now_playing_position"] > api["total_videos"] ||
    api["now_playing_position"] < 1
  ) {
    api["now_playing_position"] = 1;
    liveServer("clear");
  } else {
    api["current_video_duration"] =
      api["video_in_queue"][api["now_playing_position"] - 1].video_duration;
    api["now_playing_video_info"] =
      api["video_in_queue"][api["now_playing_position"] - 1];
  }
  io.emit("refresh");
  setTimeout(() => {
    io.emit("play");
  }, 500);
  res.send("Bỏ qua bài hát thành công!");
});

app.get("/admin/api/player/previous", function (req, res) {
  if (api["now_playing_position"] > 1) {
    api["now_playing_position"]--;
    api["elapsed_time"] = 0;
    api["current_video_duration"] =
      api["video_in_queue"][api["now_playing_position"] - 1]?.video_duration;
    api["now_playing_video_info"] =
      api["video_in_queue"][api["now_playing_position"] - 1];
    io.emit("refresh");
    setTimeout(() => {
      io.emit("play");
    }, 500);
    res.send("Đang phát lại bài hát trước đó...");
  } else {
    res.send("Không thể phát lại bài hát trước đó!");
  }
});

function nowWatching() {
  if (api["now_watching"] != "" && connectCounter > 0) {
    return " (" + api["now_watching"].join(", ") + ")";
  } else {
    return "";
  }
}

app.get("/admin/api/status", function (req, res) {
  res.send(
    "<div style='width: 100%'>Trạng thái máy chủ: Hoạt động được " +
      parseInt(moment.duration(process.uptime(), "seconds").asDays()) +
      " ngày và " +
      moment.utc(process.uptime() * 1000).format("HH:mm:ss") +
      "<br>Số người đang xem: " +
      connectCounter +
      nowWatching() +
      "<br>Tổng số video: " +
      api["total_videos"] +
      "<br>Hiện đang phát: " +
      (api["now_playing_video_info"] !== undefined &&
      api["now_playing_video_info"].video_title
        ? api["now_playing_video_info"].video_title
        : "Đang tải...") +
      "<br>Thứ tự bài hát đang phát: " +
      api["now_playing_position"] +
      "<br>Thời lượng bài hát đang phát: " +
      api["current_video_duration"] +
      "<br>Thời lượng đã phát: " +
      api["elapsed_time"] +
      "</div>"
  );
});

app.get("/admin/api/queue", function (req, res) {
  res.set("Content-Type", "text/html");
  res.send(
    "<ul style='padding: 0; margin: 0'>" +
      api["video_in_queue"]
        ?.map((vid) => {
          return (
            "<div style='display: flex; flex-direction: row;border: 1px solid black;border-radius: 10px;overflow: hidden;" +
            (vid.position == api["now_playing_position"] &&
              "background-color: #B0D0FF") +
            "'><img src='" +
            vid.video_thumbnail +
            "' style='margin-right: 15px' /><li style='justify-content: center;display: flex;flex-direction: column;'><b>" +
            vid.video_title +
            "</b><ul><li>Thứ tự: " +
            vid.position +
            "</li><li>Thời lượng: " +
            vid.video_duration +
            ` giây<a style="margin-left: 10px" href="javascript:changeSongInQueue(${vid.position})">Phát video này!</a></li></ul></li></div><br>`
          );
        })
        .join("") +
      "</ul>"
  );
});

app.get("/admin/api/queue/change", function (req, res) {
  var pos = req.query.position;
  api["now_playing_position"] = pos;
  api["current_video_duration"] =
    api["video_in_queue"][api["now_playing_position"] - 1].video_duration;
  api["now_playing_video_info"] =
    api["video_in_queue"][api["now_playing_position"] - 1];
  api["elapsed_time"] = 0;
  setTimeout(() => {
    io.emit("refresh");
  }, 1000);
  setTimeout(() => {
    io.emit("play");
  }, 2500);
  res.send("Đã chuyển bài hát thành công!");
});

app.get("/admin/api/songs/change", function (req, res) {
  res.send("Phương thức GET không được cho phép!");
});

app.post("/admin/api/songs/change", (req, res) => {
  var requestedVideo = req.body.id;
  var requester = req.body.requested_by;
  utils.getSnippet(requestedVideo).then((res) => {
    utils.getChannelAvatar(res.items[0].snippet.channelId).then((res2) => {
      api["video_in_queue"].splice(api["now_playing_position"], 0, {
        position: 1,
        is_idle_video: false,
        video_id: requestedVideo,
        video_title: res.items[0].snippet.title,
        video_thumbnail: res.items[0].snippet.thumbnails.default.url,
        video_duration: parseInt(
          moment.duration(res.items[0].contentDetails.duration).format("s")
        ),
        uploaded_by: res.items[0].snippet.channelTitle,
        channel_avatar: res2.items[0].snippet.thumbnails.default.url,
        video_views: parseInt(res.items[0].statistics.viewCount),
        published_at: res.items[0].snippet.publishedAt,
        requested_by: requester,
        voting: {
          like_count: 0,
          liked_by: [],
          disliked_by: [],
          vote_skip: 0,
          vote_remove: 0,
        },
      });

      // Code that need to be waited right after new video pushed into array
      api["video_in_queue"].forEach((ele, index) => {
        ele.position = index + 1;
      });
      api["now_playing_position"]++;
      api["total_videos"] = api["video_in_queue"].length;
      api["current_video_duration"] =
        api["video_in_queue"][api["now_playing_position"] - 1].video_duration;
      api["now_playing_video_info"] =
        api["video_in_queue"][api["now_playing_position"] - 1];
      api["elapsed_time"] = 0;
    });
  });
  setTimeout(() => {
    io.emit("refresh");
  }, 1000);
  setTimeout(() => {
    io.emit("play");
  }, 2500);
  res.set("Content-Type", "text/html");
  res.send(
    "Video bạn chọn: <b>" +
      requestedVideo +
      "</b> đã được thêm vào bài hát đang phát!"
  );
});

app.post("/admin/api/songs/vote/like", function (req, res) {
  res.send("Đã thích bài hát này thành công!");
});

app.get("/admin/api/songs/search", function (req, res) {
  var query = encodeURI(req.query.query);
  if (!query) query = "";
  res.set("Content-Type", "text/html");
  utils.getSearchResults(query).then((data) => {
    res.send(
      data.items
        .map((vid) => {
          return (
            "<div style='display: flex; flex-direction: row;border: 1px solid black;border-radius: 10px;overflow: hidden'><img src='" +
            vid.snippet.thumbnails.default.url +
            "' style='margin-right: 15px' /><li style='justify-content: center;display: flex;flex-direction: column;'><b>" +
            vid.snippet.title +
            "</b><ul><li>Đăng bởi: " +
            vid.snippet.channelTitle +
            `</li><li><a href="javascript:play('${vid.id.videoId}')">Phát video này!</a></li></ul></li></div><br>`
          );
        })
        .join("")
    );
  });
});

app.get("/admin/api/songs/search/suggest", function (req, res) {
  var query = encodeURI(req.query.query);
  if (!query) query = "";
  res.set("Content-Type", "text/html");
  utils.getSuggestQueries(query).then((data) => {
    res.send(
      "<style>body {margin: 0}</style>" +
        JSON.parse(data)[1]
          .map((ele) => {
            return `<div class="hover-search" onclick="search('${ele}')">${ele}</div>`;
          })
          .join("")
    );
  });
});

app.get("/admin/api/server/ping", function (req, res) {
  res.send("Máy chủ đang chạy được " + parseInt(process.uptime()) + " giây");
});

app.get("/admin/api/server/restart", function (req, res) {
  res.send("Đang khởi động lại máy chủ...");
  process.exit(0);
});

app.get("/admin/api/server/shutdown", function (req, res) {
  res.send("Đang tắt máy chủ...");
  exec("pm2-runtime stop server.js");
});

// always put this code at bottom for 404 handling
app.get("/*", function (req, res) {
  var requestedUrl = req.protocol + "://" + req.get("Host") + req.url;
  res.send(
    "404! Vui lòng nhập địa chỉ API chính xác!<br>Địa chỉ bạn đã nhập: " +
      requestedUrl +
      " không trùng với bất kỳ địa chỉ API công khai nào của Haca!"
  );
});
